import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { salesBudget, holiday } from '../db/schema'
import { and, gte, lt } from 'drizzle-orm'
import { logAudit } from '../services/audit'
import { requireModuleRole } from '../middleware/require-role'
import { kvCache, CacheTTL } from '../services/kv-cache'

export const salesDashboardRoutes = new Hono<{ Bindings: Env }>()

// Financial dashboards require ADMIN or FINANCE role
salesDashboardRoutes.use('*', requireModuleRole('ADMIN', 'FINANCE'))

// Helper to get configured client
function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

// SQL queries — live here so changes only need a Worker deploy
function getSummarySQL(granularity: string, hasRep: boolean, hasCustomer: boolean) {
  let periodExpr: string
  let groupBy: string
  let orderBy: string

  switch (granularity) {
    case 'daily':
      periodExpr = `CONVERT(VARCHAR(10), CAST(inv.transactiondate AS DATE), 23)`
      groupBy = periodExpr
      orderBy = periodExpr
      break
    case 'weekly':
      // Truncate to Monday of each week (1900-01-01 was a Monday)
      periodExpr = `CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(inv.transactiondate AS DATE)) % 7), CAST(inv.transactiondate AS DATE)), 23)`
      groupBy = periodExpr
      orderBy = periodExpr
      break
    case 'yearly':
      periodExpr = `FORMAT(inv.transactiondate, 'yyyy')`
      groupBy = periodExpr
      orderBy = periodExpr
      break
    default: // monthly
      periodExpr = `FORMAT(inv.transactiondate, 'yyyy-MM')`
      groupBy = periodExpr
      orderBy = periodExpr
  }

  const needsCust = hasRep || hasCustomer
  const custJoin = needsCust
    ? `LEFT JOIN orgCompany cust ON inv.companyID = cust.ID`
    : ''
  const conJoin = hasRep
    ? `LEFT JOIN orgContact con ON cust.salesContactID = con.ID`
    : ''
  const repWhere = hasRep
    ? `AND con.firstname + ' ' + con.lastname = @rep`
    : ''
  const custWhere = hasCustomer
    ? `AND cust.name = @customer`
    : ''

  return `
    SELECT
      ${periodExpr} as period,
      SUM(il.totalvalue) as totalSales,
      SUM(il.areainvoiced) / 1000.0 as totalMSF,
      SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost,
      COUNT(DISTINCT inv.ID) as invoiceCount
    FROM espInvoiceLine il
    INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
    ${custJoin}
    ${conJoin}
    LEFT JOIN espOrder o ON il.orderID = o.ID
    LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
    WHERE inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND inv.invoicestatus = 'Final'
      ${repWhere}
      ${custWhere}
    GROUP BY ${groupBy}
    ORDER BY ${orderBy}
  `
}

const SALES_SQL = {

  byRep: `
    SELECT
      con.firstname + ' ' + con.lastname as repName,
      SUM(il.totalvalue) as totalSales,
      SUM(il.areainvoiced) / 1000.0 as totalMSF,
      SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost
    FROM espInvoiceLine il
    INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
    LEFT JOIN orgCompany cust ON inv.companyID = cust.ID
    LEFT JOIN orgContact con ON cust.salesContactID = con.ID
    LEFT JOIN espOrder o ON il.orderID = o.ID
    LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
    WHERE inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND inv.invoicestatus = 'Final'
    GROUP BY con.firstname + ' ' + con.lastname
    ORDER BY totalSales DESC
  `,

  byCustomer: (limit: number) => `
    SELECT TOP ${limit}
      cust.name as customerName,
      con.firstname + ' ' + con.lastname as repName,
      SUM(il.totalvalue) as totalSales,
      SUM(il.areainvoiced) / 1000.0 as totalMSF,
      SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost,
      COUNT(DISTINCT inv.ID) as invoiceCount
    FROM espInvoiceLine il
    INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN orgCompany cust ON inv.companyID = cust.ID
    LEFT JOIN orgContact con ON cust.salesContactID = con.ID
    LEFT JOIN espOrder o ON il.orderID = o.ID
    LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
    WHERE inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND inv.invoicestatus = 'Final'
    GROUP BY cust.name, con.firstname + ' ' + con.lastname
    ORDER BY totalSales DESC
  `,

  detail: `
    SELECT
      CONVERT(VARCHAR(10), inv.transactiondate, 23) as invoiceDate,
      inv.invoicenumber as invoiceNumber,
      o.jobnumber as jobNumber,
      o.designnumber as specNumber,
      cust.name as customerName,
      con.firstname + ' ' + con.lastname as repName,
      SUM(il.totalvalue) as totalSales,
      SUM(il.areainvoiced) / 1000.0 as totalMSF,
      SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost
    FROM espInvoiceLine il
    INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN orgCompany cust ON inv.companyID = cust.ID
    LEFT JOIN orgContact con ON cust.salesContactID = con.ID
    LEFT JOIN espOrder o ON il.orderID = o.ID
    LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
    WHERE inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND inv.invoicestatus = 'Final'
    GROUP BY inv.transactiondate, inv.invoicenumber, o.jobnumber, o.designnumber, cust.name, con.firstname + ' ' + con.lastname
    ORDER BY inv.transactiondate DESC
  `,

  reps: `
    SELECT DISTINCT
      con.ID as contactId,
      con.firstname + ' ' + con.lastname as repName
    FROM orgContact con
    INNER JOIN orgCompany cust ON cust.salesContactID = con.ID
    WHERE cust.isCustomer <> 0
    ORDER BY repName
  `,

  customers: `
    SELECT DISTINCT
      cust.name as customerName
    FROM orgCompany cust
    WHERE cust.isCustomer <> 0
      AND cust.name IS NOT NULL
      AND cust.name <> ''
    ORDER BY customerName
  `,
}

// GET /api/erp/sales/date-limits
salesDashboardRoutes.get('/date-limits', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'sales:date-limits', CacheTTL.DATE_LIMITS, async () => {
      const sql = `
        SELECT
          CONVERT(VARCHAR(10), MIN(CAST(inv.transactiondate AS DATE)), 23) as minDate,
          CONVERT(VARCHAR(10), MAX(CAST(inv.transactiondate AS DATE)), 23) as maxDate
        FROM espInvoice inv
        WHERE inv.invoicestatus = 'Final'
      `
      return client.rawQuery(sql, {})
    })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sales/summary?startDate=&endDate=&granularity=monthly|weekly|yearly&rep=Name
salesDashboardRoutes.get('/summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const granularity = c.req.query('granularity') || 'monthly'
  const rep = c.req.query('rep') || ''
  const customer = c.req.query('customer') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }
  if (!['daily', 'monthly', 'weekly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, monthly, weekly, or yearly' }, 400)
  }

  try {
    const hasRep = rep.length > 0
    const hasCustomer = customer.length > 0
    const sql = getSummarySQL(granularity, hasRep, hasCustomer)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasRep) params.rep = rep
    if (hasCustomer) params.customer = customer
    const result = await client.rawQuery(sql, params)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// Backwards compat — redirect old endpoint
salesDashboardRoutes.get('/monthly-summary', async (c) => {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const url = new URL(c.req.url)
  url.pathname = url.pathname.replace('/monthly-summary', '/summary')
  url.searchParams.set('granularity', 'monthly')
  if (startDate) url.searchParams.set('startDate', startDate)
  if (endDate) url.searchParams.set('endDate', endDate)
  return c.redirect(url.toString())
})

// GET /api/erp/sales/by-rep?startDate=&endDate=
salesDashboardRoutes.get('/by-rep', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const result = await client.rawQuery(SALES_SQL.byRep, { startDate, endDate })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sales/by-customer?startDate=&endDate=&limit=50
salesDashboardRoutes.get('/by-customer', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const limit = parseInt(c.req.query('limit') || '50', 10)
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const result = await client.rawQuery(SALES_SQL.byCustomer(limit), { startDate, endDate })
    return c.json({ data: result.data })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sales/detail?startDate=&endDate=
salesDashboardRoutes.get('/detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const result = await client.rawQuery<Record<string, unknown>>(SALES_SQL.detail, { startDate, endDate })
    const data = (result.data ?? []).map((r) => ({
      invoiceDate: String(r.invoiceDate ?? r.invoicedate ?? ''),
      invoiceNumber: String(r.invoiceNumber ?? r.invoicenumber ?? ''),
      jobNumber: String(r.jobNumber ?? r.jobnumber ?? ''),
      specNumber: String(r.specNumber ?? r.specnumber ?? r.designnumber ?? ''),
      customerName: String(r.customerName ?? r.customername ?? ''),
      repName: String(r.repName ?? r.repname ?? ''),
      totalSales: Number(r.totalSales ?? r.totalsales ?? 0),
      totalMSF: Number(r.totalMSF ?? r.totalmsf ?? 0),
      totalCost: Number(r.totalCost ?? r.totalcost ?? 0),
    }))
    return c.json({ data })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sales/reps
salesDashboardRoutes.get('/reps', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'sales:reps', CacheTTL.LOOKUP_DATA, () =>
      client.rawQuery(SALES_SQL.reps)
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sales/customers
salesDashboardRoutes.get('/customers', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'sales:customers', CacheTTL.LOOKUP_DATA, () =>
      client.rawQuery(SALES_SQL.customers)
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// POST /api/erp/sales/query - raw SQL proxy for SQL Explorer (ADMIN only)
salesDashboardRoutes.post('/query', async (c) => {
  // Security: Restrict SQL Explorer to ADMIN role only
  const auth = c.get('auth')
  if (!auth?.roles?.includes('ADMIN')) {
    return c.json({ error: 'Forbidden: ADMIN role required for SQL Explorer' }, 403)
  }

  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const body = await c.req.json<{ sql: string; params?: Record<string, unknown> }>()
  if (!body.sql) {
    return c.json({ error: 'sql is required' }, 400)
  }

  // Validate: only allow SELECT/WITH statements
  const trimmed = body.sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return c.json({ error: 'Only SELECT queries are allowed' }, 400)
  }

  try {
    await logAudit(c, { action: 'sql_explorer.query', resource: 'sql_explorer', metadata: { sql: body.sql.substring(0, 500) } })
    const result = await client.rawQuery(body.sql, body.params)
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    console.error('[SQL Explorer] Query error:', err)
    return c.json({ error: 'Query execution failed' }, 500)
  }
})

// GET /api/erp/sales/budgets?year=2025
salesDashboardRoutes.get('/budgets', async (c) => {
  const db = c.get('db')
  const year = c.req.query('year')
  if (!year) {
    return c.json({ error: 'year is required' }, 400)
  }

  const startMonth = `${year}-01-01`
  const endMonth = `${parseInt(year) + 1}-01-01`

  const budgets = await db
    .select()
    .from(salesBudget)
    .where(and(
      gte(salesBudget.month, startMonth),
      lt(salesBudget.month, endMonth)
    ))

  return c.json({ data: budgets })
})

// GET /api/erp/sales/holidays?startDate=&endDate=
salesDashboardRoutes.get('/holidays', async (c) => {
  const db = c.get('db')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  const holidays = await db
    .select()
    .from(holiday)
    .where(and(
      gte(holiday.holidayDate, startDate),
      lt(holiday.holidayDate, endDate)
    ))

  return c.json({ data: holidays })
})
