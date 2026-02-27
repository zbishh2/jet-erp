import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { kvCache, cacheKey, CacheTTL } from '../services/kv-cache'

export const sqFtDashboardRoutes = new Hono<{ Bindings: Env }>()

function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

const SQ_FT_PER_BOX_EXPR = `
  (CAST(pf.entry_width AS FLOAT) / 192.0)
  * (CAST(pf.entry_length AS FLOAT) / 192.0)
`

const SQ_FT_ENTRY_EXPR = `
  (${SQ_FT_PER_BOX_EXPR}) * CAST(pf.quantity_fed_in AS FLOAT)
`

const ORDER_HOURS_EXPR = `
  CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0
`

function getPeriodExpr(granularity: string) {
  switch (granularity) {
    case 'daily':
      return `CONVERT(VARCHAR(10), CAST(pf.feedback_report_date AS DATE), 23)`
    case 'monthly':
      return `FORMAT(pf.feedback_report_date, 'yyyy-MM')`
    case 'yearly':
      return `FORMAT(pf.feedback_report_date, 'yyyy')`
    case 'weekly':
    default:
      return `CONVERT(VARCHAR(10), DATEADD(DAY, - (DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23)`
  }
}

function sqftFromClause(
  hasLine: boolean,
  hasCustomer: boolean,
  hasSpec: boolean,
  includeDateRange = true
) {
  const lineWhere = hasLine ? `AND cc.costcenter_number = @line` : ''
  const customerWhere = hasCustomer ? `AND ISNULL(po.customer_name, '') = @customer` : ''
  const specWhere = hasSpec ? `AND ISNULL(po.spec_number, '') = @spec` : ''
  const dateWhere = includeDateRange
    ? `AND pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate`
    : ''

  return `
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN dwproductionorders po
      ON pf.feedback_pcs_order_id = po.pcs_order_id
    WHERE 1 = 1
      ${dateWhere}
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)

      ${lineWhere}
      ${customerWhere}
      ${specWhere}
  `
}

function getSummarySQL(granularity: string, hasLine: boolean, hasCustomer: boolean, hasSpec: boolean) {
  const periodExpr = getPeriodExpr(granularity)
  return `
    SELECT
      ${periodExpr} as period,
      SUM(${SQ_FT_ENTRY_EXPR}) as sqFtEntry,
      SUM(${ORDER_HOURS_EXPR}) as orderHours,
      COUNT(DISTINCT CAST(pf.feedback_report_date AS DATE)) as dayCount
    ${sqftFromClause(hasLine, hasCustomer, hasSpec)}
    GROUP BY ${periodExpr}
    ORDER BY ${periodExpr}
  `
}

function getByLineSQL(hasLine: boolean, hasCustomer: boolean, hasSpec: boolean) {
  return `
    SELECT
      CAST(cc.costcenter_number AS VARCHAR(3)) as lineNumber,
      SUM(${SQ_FT_ENTRY_EXPR}) as sqFtEntry,
      SUM(${ORDER_HOURS_EXPR}) as orderHours
    ${sqftFromClause(hasLine, hasCustomer, hasSpec)}
    GROUP BY cc.costcenter_number
    ORDER BY sqFtEntry DESC
  `
}

function getDetailsSQL(hasLine: boolean, hasCustomer: boolean, hasSpec: boolean) {
  return `
    SELECT
      CAST(pf.feedback_report_date AS DATE) as feedbackDate,
      ISNULL(po.job_number, '') as jobNumber,
      ISNULL(po.customer_name, 'Unknown') as customerName,
      ISNULL(po.spec_number, '') as specNumber,
      CAST(cc.costcenter_number AS VARCHAR(3)) as lineNumber,
      SUM(${SQ_FT_ENTRY_EXPR}) as sqFtEntry,
      AVG(${SQ_FT_PER_BOX_EXPR}) as sqFtPerBox,
      SUM(${ORDER_HOURS_EXPR}) as orderHours
    ${sqftFromClause(hasLine, hasCustomer, hasSpec)}
    GROUP BY
      CAST(pf.feedback_report_date AS DATE),
      po.job_number,
      po.customer_name,
      po.spec_number,
      cc.costcenter_number
    ORDER BY feedbackDate DESC, jobNumber DESC
  `
}

function getDateLimitsSQL() {
  return `
    SELECT
      CONVERT(VARCHAR(10), MIN(CAST(pf.feedback_report_date AS DATE)), 23) as minDate,
      CONVERT(VARCHAR(10), MAX(CAST(pf.feedback_report_date AS DATE)), 23) as maxDate
    ${sqftFromClause(false, false, false, false)}
  `
}

function getLineOptionsSQL(hasCustomer: boolean, hasSpec: boolean) {
  return `
    SELECT DISTINCT
      CAST(cc.costcenter_number AS VARCHAR(3)) as lineNumber
    ${sqftFromClause(false, hasCustomer, hasSpec)}
    ORDER BY lineNumber
  `
}

function getCustomerOptionsSQL(hasLine: boolean, hasSpec: boolean) {
  return `
    SELECT DISTINCT
      ISNULL(po.customer_name, 'Unknown') as customerName
    ${sqftFromClause(hasLine, false, hasSpec)}
    ORDER BY customerName
  `
}

function getSpecOptionsSQL(hasLine: boolean, hasCustomer: boolean) {
  return `
    SELECT DISTINCT
      ISNULL(po.spec_number, '') as specNumber
    ${sqftFromClause(hasLine, hasCustomer, false)}
      AND po.spec_number IS NOT NULL
      AND po.spec_number <> ''
    ORDER BY specNumber
  `
}

function parseDashboardFilters(c: {
  req: { query: (name: string) => string | undefined }
}) {
  const line = c.req.query('line') || ''
  const customer = c.req.query('customer') || ''
  const spec = c.req.query('spec') || ''
  return {
    line,
    customer,
    spec,
    hasLine: line.length > 0,
    hasCustomer: customer.length > 0,
    hasSpec: spec.length > 0,
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

// GET /api/erp/sqft/date-limits
sqFtDashboardRoutes.get('/date-limits', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'sqft:date-limits', CacheTTL.DATE_LIMITS, () =>
      client.rawQuery(getDateLimitsSQL(), {}, 'kdw')
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sqft/summary?startDate=&endDate=&granularity=&line=&customer=&spec=
sqFtDashboardRoutes.get('/summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const granularity = c.req.query('granularity') || 'weekly'
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, weekly, monthly, or yearly' }, 400)
  }

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const sql = getSummarySQL(granularity, hasLine, hasCustomer, hasSpec)
    const params: Record<string, unknown> = {
      startDate: dates.startDate,
      endDate: dates.endDate,
    }
    if (hasLine) params.line = parseInt(line, 10)
    if (hasCustomer) params.customer = customer
    if (hasSpec) params.spec = spec
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sqft/by-line?startDate=&endDate=&line=&customer=&spec=
sqFtDashboardRoutes.get('/by-line', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const sql = getByLineSQL(hasLine, hasCustomer, hasSpec)
    const params: Record<string, unknown> = {
      startDate: dates.startDate,
      endDate: dates.endDate,
    }
    if (hasLine) params.line = parseInt(line, 10)
    if (hasCustomer) params.customer = customer
    if (hasSpec) params.spec = spec
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sqft/details?startDate=&endDate=&line=&customer=&spec=
sqFtDashboardRoutes.get('/details', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const sql = getDetailsSQL(hasLine, hasCustomer, hasSpec)
    const params: Record<string, unknown> = {
      startDate: dates.startDate,
      endDate: dates.endDate,
    }
    if (hasLine) params.line = parseInt(line, 10)
    if (hasCustomer) params.customer = customer
    if (hasSpec) params.spec = spec
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/sqft/filter-options?startDate=&endDate=&line=&customer=&spec=
sqFtDashboardRoutes.get('/filter-options', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const kv = c.env.AUTH_CACHE
    const key = cacheKey('sqft:filter-options', {
      s: dates.startDate, e: dates.endDate,
      l: line, c: customer, sp: spec,
    })
    const result = await kvCache(kv, key, CacheTTL.FILTER_OPTIONS, async () => {
      const lineSql = getLineOptionsSQL(hasCustomer, hasSpec)
      const customerSql = getCustomerOptionsSQL(hasLine, hasSpec)
      const specSql = getSpecOptionsSQL(hasLine, hasCustomer)

      const lineParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasCustomer) lineParams.customer = customer
      if (hasSpec) lineParams.spec = spec

      const customerParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasLine) customerParams.line = parseInt(line, 10)
      if (hasSpec) customerParams.spec = spec

      const specParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasLine) specParams.line = parseInt(line, 10)
      if (hasCustomer) specParams.customer = customer

      const [linesRes, customersRes, specsRes] = await Promise.all([
        client.rawQuery(lineSql, lineParams, 'kdw'),
        client.rawQuery(customerSql, customerParams, 'kdw'),
        client.rawQuery(specSql, specParams, 'kdw'),
      ])

      return {
        lineNumbers: ((linesRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.lineNumber ?? '')),
        customers: ((customersRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.customerName ?? '')),
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
