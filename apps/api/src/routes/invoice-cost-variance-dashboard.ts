import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { requireModuleRole } from '../middleware/require-role'
import { kvCache, cacheKey, CacheTTL } from '../services/kv-cache'

export const invoiceCostVarianceDashboardRoutes = new Hono<{ Bindings: Env }>()

// Financial dashboards require ADMIN or FINANCE role
invoiceCostVarianceDashboardRoutes.use('*', requireModuleRole('ADMIN', 'FINANCE'))

function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toDateKey(value: unknown): string {
  const raw = String(value ?? '')
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDate) return isoDate[1]
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return raw
}

function getPeriodKey(dateKey: string, granularity: string): string {
  if (granularity === 'yearly') return dateKey.slice(0, 4)
  if (granularity === 'monthly') return dateKey.slice(0, 7)
  if (granularity === 'daily') return dateKey
  // weekly: align to Monday start
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  const dayOfWeek = dt.getUTCDay() // 0=Sun
  dt.setUTCDate(dt.getUTCDate() - ((dayOfWeek + 6) % 7)) // rewind to Monday
  return dt.toISOString().slice(0, 10)
}

function parseDashboardFilters(c: {
  req: { query: (name: string) => string | undefined }
}) {
  const customer = c.req.query('customer') || ''
  const spec = c.req.query('spec') || ''
  const salesRep = c.req.query('salesRep') || ''
  return {
    customer,
    spec,
    salesRep,
    hasCustomer: customer.length > 0,
    hasSpec: spec.length > 0,
    hasSalesRep: salesRep.length > 0,
  }
}

function requireDates(c: {
  req: { query: (name: string) => string | undefined }
  json: (body: unknown, status?: number) => Response
}) {
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  if (!startDate || !endDate) {
    return { error: c.json({ error: 'startDate and endDate are required' }, 400) }
  }
  return { startDate, endDate }
}

// ---------------------------------------------------------------------------
// SQL: single ESP query with all JOINs
// ---------------------------------------------------------------------------

function getInvoiceCostVarianceSQL(hasCustomer: boolean, hasSpec: boolean, hasSalesRep: boolean) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''

  return `
    SELECT
      CONVERT(VARCHAR(10), inv.transactiondate, 23) as invoiceDate,
      inv.invoicenumber as invoiceNumber,
      o.jobnumber as jobNumber,
      ISNULL(cust.name, 'Unknown') as customerName,
      ISNULL(pd.designnumber, '') as specNumber,
      ISNULL(salescon.firstname + ' ' + salescon.lastname, '') as salesRep,
      TRY_CAST(il.quantity AS FLOAT) as quantity,
      CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(pce.materialcost AS FLOAT) / 1000.0 ELSE NULL END as preMaterialCostPerUnit,
      CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(pce.labourcost AS FLOAT) / 1000.0 ELSE NULL END as preLaborCostPerUnit,
      CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(pce.freightcost AS FLOAT) / 1000.0 ELSE NULL END as preFreightCostPerUnit,
      CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(postce.materialcost AS FLOAT) / 1000.0 ELSE NULL END as postMaterialCostPerUnit,
      CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(postce.labourcost AS FLOAT) / 1000.0 ELSE NULL END as postLaborCostPerUnit,
      CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(postce.freightcost AS FLOAT) / 1000.0 ELSE NULL END as postFreightCostPerUnit,
      routing.totalSetupHours,
      routing.hoursPerThousand,
      routing.stdRunRate,
      routing.totalSetupMins,
      ISNULL(pd.noperset, 1) * ISNULL(pd.noofsets, 1) as numberOut
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON pp.productDesignID = pd.ID
    LEFT JOIN dbo.orgCompany cust ON pd.companyID = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    LEFT JOIN dbo.cstCostEstimate pce ON o.precostestimateID = pce.ID
    LEFT JOIN dbo.ocsPostcostedorder pco ON o.ID = pco.orderID
    LEFT JOIN dbo.cstCostEstimate postce ON pco.costEstimateID = postce.ID
    LEFT JOIN (
      SELECT jobnumber,
        SUM(setupHrs) as totalSetupHours,
        SUM(hrsPerK) as hoursPerThousand,
        MAX(runRate) as stdRunRate,
        SUM(setupMin) as totalSetupMins
      FROM (
        SELECT o2.jobnumber, rs.sequencenumber,
          MIN(COALESCE(rs.routingstdsetupmins, rs.costingstdsetupmins, 0)) / 60.0 as setupHrs,
          1000.0 / NULLIF(MAX(COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0)), 0) as hrsPerK,
          MAX(COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0)) as runRate,
          MIN(COALESCE(rs.routingstdsetupmins, rs.costingstdsetupmins, 0)) as setupMin
        FROM dbo.espOrder o2
        INNER JOIN dbo.espMachineRouteStep rs ON rs.routeID = o2.routeID
        WHERE o2.routeID IS NOT NULL
          AND rs.machineno IN (130,131,132,133,142,144,146,154)
          AND COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0) > 0
        GROUP BY o2.jobnumber, rs.sequencenumber
      ) steps
      GROUP BY jobnumber
    ) routing ON routing.jobnumber = o.jobnumber
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      ${customerWhere}
      ${salesRepWhere}
      ${specWhere}
  `
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InvoiceRow = {
  invoiceDate: unknown
  invoiceNumber: unknown
  jobNumber: unknown
  customerName: unknown
  specNumber: unknown
  salesRep: unknown
  quantity: unknown
  preMaterialCostPerUnit: unknown
  preLaborCostPerUnit: unknown
  preFreightCostPerUnit: unknown
  postMaterialCostPerUnit: unknown
  postLaborCostPerUnit: unknown
  postFreightCostPerUnit: unknown
  totalSetupHours: unknown
  hoursPerThousand: unknown
  stdRunRate: unknown
  totalSetupMins: unknown
  numberOut: unknown
}

interface ComputedRow {
  invoiceDate: string
  invoiceNumber: string
  jobNumber: string
  customerName: string
  specNumber: string
  salesRep: string
  quantity: number
  estimatedHours: number
  stdRunRate: number
  setupMins: number
  estMaterialCost: number
  estLaborCost: number
  estFreightCost: number
  actMaterialCost: number
  actLaborCost: number
  actFreightCost: number
  numberOut: number
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

function computeRows(rawRows: InvoiceRow[]): ComputedRow[] {
  return rawRows.map((row) => {
    const qty = toNumber(row.quantity)
    const totalSetupHours = toNumber(row.totalSetupHours)
    const hoursPerThousand = toNumber(row.hoursPerThousand)
    const estimatedHours = totalSetupHours + (qty / 1000) * hoursPerThousand

    const preMat = toNumber(row.preMaterialCostPerUnit)
    const preLab = toNumber(row.preLaborCostPerUnit)
    const preFrt = toNumber(row.preFreightCostPerUnit)
    const postMat = toNumber(row.postMaterialCostPerUnit)
    const postLab = toNumber(row.postLaborCostPerUnit)
    const postFrt = toNumber(row.postFreightCostPerUnit)

    return {
      invoiceDate: toDateKey(row.invoiceDate),
      invoiceNumber: String(row.invoiceNumber ?? ''),
      jobNumber: String(row.jobNumber ?? ''),
      customerName: String(row.customerName ?? 'Unknown'),
      specNumber: String(row.specNumber ?? ''),
      salesRep: String(row.salesRep ?? ''),
      quantity: qty,
      estimatedHours,
      stdRunRate: toNumber(row.stdRunRate),
      setupMins: toNumber(row.totalSetupMins),
      estMaterialCost: preMat * qty,
      estLaborCost: preLab * qty,
      estFreightCost: preFrt * qty,
      actMaterialCost: postMat * qty,
      actLaborCost: postLab * qty,
      actFreightCost: postFrt * qty,
      numberOut: toNumber(row.numberOut) || 1,
    }
  })
}

// ---------------------------------------------------------------------------
// Filter options SQL
// ---------------------------------------------------------------------------

function getDateLimitsSQL() {
  return `
    SELECT
      CONVERT(VARCHAR(10), MIN(inv.transactiondate), 23) as minDate,
      CONVERT(VARCHAR(10), MAX(inv.transactiondate), 23) as maxDate
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
  `
}

function getCustomerOptionsSQL(hasSpec: boolean, hasSalesRep: boolean = false) {
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''
  return `
    SELECT DISTINCT ISNULL(cust.name, 'Unknown') as customerName
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON pp.productDesignID = pd.ID
    LEFT JOIN dbo.orgCompany cust ON pd.companyID = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      ${specWhere}
      ${salesRepWhere}
    ORDER BY customerName
  `
}

function getSalesRepOptionsSQL(hasCustomer: boolean, hasSpec: boolean) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  return `
    SELECT DISTINCT ISNULL(salescon.firstname + ' ' + salescon.lastname, '') as salesRep
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON pp.productDesignID = pd.ID
    LEFT JOIN dbo.orgCompany cust ON pd.companyID = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') <> ''
      ${customerWhere}
      ${specWhere}
    ORDER BY salesRep
  `
}

function getSpecOptionsSQL(hasCustomer: boolean, hasSalesRep: boolean = false) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''
  return `
    SELECT DISTINCT pd.designnumber as specNumber
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON pp.productDesignID = pd.ID
    LEFT JOIN dbo.orgCompany cust ON pd.companyID = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND pd.designnumber IS NOT NULL
      AND pd.designnumber <> ''
      ${customerWhere}
      ${salesRepWhere}
    ORDER BY specNumber
  `
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

// GET /api/erp/invoice-cost-variance/date-limits
invoiceCostVarianceDashboardRoutes.get('/date-limits', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'invoice-cv:date-limits', CacheTTL.DATE_LIMITS, () =>
      client.rawQuery(getDateLimitsSQL(), {}, 'esp')
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/invoice-cost-variance/summary?startDate&endDate&granularity&customer?&spec?
invoiceCostVarianceDashboardRoutes.get('/summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const granularity = c.req.query('granularity') || 'daily'
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, weekly, monthly, or yearly' }, 400)
  }

  const { customer, spec, salesRep, hasCustomer, hasSpec, hasSalesRep } = parseDashboardFilters(c)

  try {
    const params: Record<string, unknown> = {
      startDate: dates.startDate,
      endDate: dates.endDate,
    }
    if (hasCustomer) params.customer = customer
    if (hasSpec) params.spec = spec
    if (hasSalesRep) params.salesRep = salesRep

    const result = await client.rawQuery<InvoiceRow>(
      getInvoiceCostVarianceSQL(hasCustomer, hasSpec, hasSalesRep),
      params,
      'esp'
    )
    const rows = computeRows(result.data ?? [])

    // Aggregate by period
    type PeriodAgg = {
      estMaterialCost: number; estLaborCost: number; estFreightCost: number
      actMaterialCost: number; actLaborCost: number; actFreightCost: number
      estimatedHours: number; quantity: number
    }
    const byPeriod = new Map<string, PeriodAgg>()
    for (const row of rows) {
      const period = getPeriodKey(row.invoiceDate, granularity)
      const agg = byPeriod.get(period) ?? {
        estMaterialCost: 0, estLaborCost: 0, estFreightCost: 0,
        actMaterialCost: 0, actLaborCost: 0, actFreightCost: 0,
        estimatedHours: 0, quantity: 0,
      }
      agg.estMaterialCost += row.estMaterialCost
      agg.estLaborCost += row.estLaborCost
      agg.estFreightCost += row.estFreightCost
      agg.actMaterialCost += row.actMaterialCost
      agg.actLaborCost += row.actLaborCost
      agg.actFreightCost += row.actFreightCost
      agg.estimatedHours += row.estimatedHours
      agg.quantity += row.quantity
      byPeriod.set(period, agg)
    }

    const data = [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, agg]) => ({ period, ...agg }))

    return c.json({ data })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/invoice-cost-variance/details?startDate&endDate&customer?&spec?
invoiceCostVarianceDashboardRoutes.get('/details', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { customer, spec, salesRep, hasCustomer, hasSpec, hasSalesRep } = parseDashboardFilters(c)
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(c.req.query('pageSize') || '100', 10)))
  const sortField = c.req.query('sortField') || 'invoiceDate'
  const sortDir = (c.req.query('sortDir') || 'desc') as 'asc' | 'desc'

  try {
    const params: Record<string, unknown> = {
      startDate: dates.startDate,
      endDate: dates.endDate,
    }
    if (hasCustomer) params.customer = customer
    if (hasSpec) params.spec = spec
    if (hasSalesRep) params.salesRep = salesRep

    const result = await client.rawQuery<InvoiceRow>(
      getInvoiceCostVarianceSQL(hasCustomer, hasSpec, hasSalesRep),
      params,
      'esp'
    )
    const rows = computeRows(result.data ?? [])

    // Aggregate by date+invoiceNumber+job+customer+spec
    const byDetail = new Map<string, ComputedRow>()
    for (const row of rows) {
      const key = [row.invoiceDate, row.invoiceNumber, row.jobNumber, row.customerName, row.specNumber].join('|')
      const existing = byDetail.get(key)
      if (!existing) {
        byDetail.set(key, { ...row })
      } else {
        existing.quantity += row.quantity
        existing.estimatedHours += row.estimatedHours
        existing.estMaterialCost += row.estMaterialCost
        existing.estLaborCost += row.estLaborCost
        existing.estFreightCost += row.estFreightCost
        existing.actMaterialCost += row.actMaterialCost
        existing.actLaborCost += row.actLaborCost
        existing.actFreightCost += row.actFreightCost
      }
    }

    // Resolve computed sort fields that don't exist on the raw row
    const getSortVal = (r: ComputedRow, field: string): unknown => {
      switch (field) {
        case 'estFull': return r.estMaterialCost + r.estLaborCost
        case 'actFull': return r.actMaterialCost + r.actLaborCost
        case 'variance': return (r.estMaterialCost + r.estLaborCost) - (r.actMaterialCost + r.actLaborCost)
        case 'materialVariance': return r.estMaterialCost - r.actMaterialCost
        case 'laborVariance': return r.estLaborCost - r.actLaborCost
        case 'estHours': return r.estimatedHours
        default: return (r as unknown as Record<string, unknown>)[field]
      }
    }

    const allData = [...byDetail.values()].sort((a, b) => {
      const aVal = getSortVal(a, sortField)
      const bVal = getSortVal(b, sortField)
      const dir = sortDir === 'asc' ? 1 : -1
      if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir
      return String(aVal ?? '').localeCompare(String(bVal ?? '')) * dir
    })

    // Compute totals from full dataset
    const totals = {
      estMaterialCost: 0, estLaborCost: 0, estFreightCost: 0,
      actMaterialCost: 0, actLaborCost: 0, actFreightCost: 0,
      quantity: 0, estimatedHours: 0,
    }
    for (const r of allData) {
      totals.estMaterialCost += r.estMaterialCost
      totals.estLaborCost += r.estLaborCost
      totals.estFreightCost += r.estFreightCost
      totals.actMaterialCost += r.actMaterialCost
      totals.actLaborCost += r.actLaborCost
      totals.actFreightCost += r.actFreightCost
      totals.quantity += r.quantity
      totals.estimatedHours += r.estimatedHours
    }

    const total = allData.length
    const data = allData.slice((page - 1) * pageSize, page * pageSize)

    return c.json({ data, totals, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/invoice-cost-variance/filter-options?startDate&endDate&customer?&spec?
invoiceCostVarianceDashboardRoutes.get('/filter-options', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { customer, spec, salesRep, hasCustomer, hasSpec, hasSalesRep } = parseDashboardFilters(c)

  try {
    const kv = c.env.AUTH_CACHE
    const key = cacheKey('invoice-cv:filter-options', {
      s: dates.startDate, e: dates.endDate,
      c: customer, sp: spec, sr: salesRep,
    })

    const result = await kvCache(kv, key, CacheTTL.FILTER_OPTIONS, async () => {
      const customerParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasSpec) customerParams.spec = spec
      if (hasSalesRep) customerParams.salesRep = salesRep

      const salesRepParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasCustomer) salesRepParams.customer = customer
      if (hasSpec) salesRepParams.spec = spec

      const specParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasCustomer) specParams.customer = customer
      if (hasSalesRep) specParams.salesRep = salesRep

      const [customersRes, salesRepsRes, specsRes] = await Promise.all([
        client.rawQuery(getCustomerOptionsSQL(hasSpec, hasSalesRep), customerParams, 'esp'),
        client.rawQuery(getSalesRepOptionsSQL(hasCustomer, hasSpec), salesRepParams, 'esp'),
        client.rawQuery(getSpecOptionsSQL(hasCustomer, hasSalesRep), specParams, 'esp'),
      ])

      return {
        customers: ((customersRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.customerName ?? '')),
        salesReps: ((salesRepsRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.salesRep ?? '')),
        specs: ((specsRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.specNumber ?? '')),
      }
    })

    return c.json({ data: result })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})
