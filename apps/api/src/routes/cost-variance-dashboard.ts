import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { requireModuleRole } from '../middleware/require-role'
import { kvCache, cacheKey, CacheTTL } from '../services/kv-cache'

export const costVarianceDashboardRoutes = new Hono<{ Bindings: Env }>()

// Financial dashboards require ADMIN or FINANCE role
costVarianceDashboardRoutes.use('*', requireModuleRole('ADMIN', 'FINANCE'))

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
// KDW-only SQL helpers (no cross-database references)
// ---------------------------------------------------------------------------

function kdwFromClause(
  hasLine: boolean,
  hasCustomer: boolean,
  hasSpec: boolean,
  includeDateRange = true,
  hasJob = false
) {
  const lineWhere = hasLine ? `AND cc.costcenter_number = @line` : ''
  const customerWhere = hasCustomer ? `AND ISNULL(po.customer_name, '') = @customer` : ''
  const specWhere = hasSpec ? `AND ISNULL(po.spec_number, '') = @spec` : ''
  const jobWhere = hasJob ? `AND ISNULL(po.job_number, '') = @job` : ''
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
      ${jobWhere}
  `
}

function getBaseRowsSQL(hasLine: boolean, hasCustomer: boolean, hasSpec: boolean, hasJob = false) {
  const lineWhere = hasLine ? `AND cc.costcenter_number = @line` : ''
  const customerWhere = hasCustomer ? `AND ISNULL(po.customer_name, '') = @customer` : ''
  const specWhere = hasSpec ? `AND ISNULL(po.spec_number, '') = @spec` : ''
  const jobWhere = hasJob ? `AND ISNULL(po.job_number, '') = @job` : ''

  return `
    SELECT
      CAST(pf.feedback_report_date AS DATE) as feedbackDate,
      ISNULL(po.job_number, '') as jobNumber,
      ISNULL(po.customer_name, 'Unknown') as customerName,
      ISNULL(po.spec_number, '') as specNumber,
      CAST(cc.costcenter_number AS VARCHAR(3)) as lineNumber,
      CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0 as orderHours,
      TRY_CAST(pf.quantity_produced AS FLOAT) as quantityProduced,
      (DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) - CAST(pf.setup_duration_seconds AS FLOAT))
        / 3600.0
        + ISNULL(dt.setupDowntimeHours, 0)
        - ISNULL(dt.totalDowntimeHours, 0) as uptimeHours,
      CASE WHEN ISNULL(jss.number_up_exit_1, 0) > 0
        THEN CAST(jss.number_up_entry_1 AS FLOAT) / jss.number_up_exit_1
        ELSE 1 END as numberOut
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN dwproductionorders po
      ON pf.feedback_pcs_order_id = po.pcs_order_id
    LEFT JOIN (
      SELECT
        downtime_job_series_step_id,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
      FROM dwdowntimes
      GROUP BY downtime_job_series_step_id
    ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
    WHERE 1 = 1
      AND pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      ${lineWhere}
      ${customerWhere}
      ${specWhere}
      ${jobWhere}
  `
}

function getMachineCountsSQL(jobClause: string) {
  return `
    SELECT
      po.job_number as jobNumber,
      COUNT(DISTINCT cc.costcenter_number) as machineCount
    FROM dwproductionfeedback pf
    INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
    INNER JOIN dwproductionorders po ON pf.feedback_pcs_order_id = po.pcs_order_id
    WHERE cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      AND po.job_number IS NOT NULL
      AND ${jobClause}
    GROUP BY po.job_number
  `
}

// ---------------------------------------------------------------------------
// ESP-only SQL helpers (cost estimates + routing steps)
// ---------------------------------------------------------------------------

function getRoutingStepsSQL(jobClause: string) {
  // Only include corrugator machines (matching KDW cost centers).
  // Group by sequence number to deduplicate alternative machines at the same step.
  return `
    SELECT
      o.jobnumber as jobNumber,
      rs.sequencenumber as seq,
      MAX(COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0)) as runRate,
      MIN(COALESCE(rs.routingstdsetupmins, rs.costingstdsetupmins, 0)) as setupMins
    FROM dbo.espOrder o
    INNER JOIN dbo.espMachineRouteStep rs ON rs.routeID = o.routeID
    WHERE ${jobClause}
      AND o.routeID IS NOT NULL
      AND rs.machineno IN (130, 131, 132, 133, 142, 144, 146, 154)
      AND COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0) > 0
    GROUP BY o.jobnumber, rs.sequencenumber
  `
}

function getCostEstimatesSQL(jobClause: string) {
  return `
    SELECT
      o.jobnumber as jobNumber,
      MAX(CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(pce.materialcost AS FLOAT) / 1000.0 ELSE NULL END) as preMaterialCostPerUnit,
      MAX(CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(pce.labourcost AS FLOAT) / 1000.0 ELSE NULL END) as preLaborCostPerUnit,
      MAX(CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(pce.freightcost AS FLOAT) / 1000.0 ELSE NULL END) as preFreightCostPerUnit,
      MAX(CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(postce.materialcost AS FLOAT) / 1000.0 ELSE NULL END) as postMaterialCostPerUnit,
      MAX(CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(postce.labourcost AS FLOAT) / 1000.0 ELSE NULL END) as postLaborCostPerUnit,
      MAX(CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(postce.freightcost AS FLOAT) / 1000.0 ELSE NULL END) as postFreightCostPerUnit
    FROM dbo.espOrder o
    LEFT JOIN dbo.cstCostEstimate pce ON o.precostestimateID = pce.ID
    LEFT JOIN dbo.ocsPostcostedorder pco ON o.ID = pco.orderID
    LEFT JOIN dbo.cstCostEstimate postce ON pco.costEstimateID = postce.ID
    WHERE ${jobClause}
    GROUP BY o.jobnumber
  `
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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

function buildStringInClause(column: string, values: string[], prefix: string) {
  const unique = [...new Set(values.filter((v) => v.length > 0))]
  if (unique.length === 0) {
    return { clause: '1 = 0', params: {} as Record<string, unknown> }
  }
  const chunkSize = 900
  const params: Record<string, unknown> = {}
  const chunks: string[] = []
  for (let start = 0; start < unique.length; start += chunkSize) {
    const slice = unique.slice(start, start + chunkSize)
    const placeholders: string[] = []
    slice.forEach((value, idx) => {
      const key = `${prefix}${start + idx}`
      placeholders.push(`@${key}`)
      params[key] = value
    })
    chunks.push(`${column} IN (${placeholders.join(', ')})`)
  }
  return {
    clause: chunks.length === 1 ? chunks[0] : `(${chunks.join(' OR ')})`,
    params,
  }
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

// ---------------------------------------------------------------------------
// Core computation: fetch from kdw + esp, join in JS
// ---------------------------------------------------------------------------

type BaseRow = {
  feedbackDate: unknown
  jobNumber: unknown
  customerName: unknown
  specNumber: unknown
  lineNumber: unknown
  orderHours: unknown
  quantityProduced: unknown
  uptimeHours: unknown
}

type MachineCountRow = {
  jobNumber: unknown
  machineCount: unknown
}

type CostEstimateRow = {
  jobNumber: unknown
  preMaterialCostPerUnit: unknown
  preLaborCostPerUnit: unknown
  preFreightCostPerUnit: unknown
  postMaterialCostPerUnit: unknown
  postLaborCostPerUnit: unknown
  postFreightCostPerUnit: unknown
}

type RoutingStepRow = {
  jobNumber: unknown
  seq: unknown
  runRate: unknown
  setupMins: unknown
}

interface ComputedRow {
  feedbackDate: string
  jobNumber: string
  customerName: string
  specNumber: string
  lineNumber: string
  orderHours: number
  uptimeHours: number
  estimatedHours: number
  adjQty: number
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

async function computeCostVarianceRows(
  client: ReturnType<typeof createKiwiplanClient>,
  args: {
    startDate: string
    endDate: string
    line: string
    customer: string
    spec: string
    job: string
    hasLine: boolean
    hasCustomer: boolean
    hasSpec: boolean
    hasJob: boolean
  }
): Promise<ComputedRow[]> {
  // Step 1: fetch base rows from KDW
  const baseParams: Record<string, unknown> = {
    startDate: args.startDate,
    endDate: args.endDate,
  }
  if (args.hasLine) baseParams.line = parseInt(args.line, 10)
  if (args.hasCustomer) baseParams.customer = args.customer
  if (args.hasSpec) baseParams.spec = args.spec
  if (args.hasJob) baseParams.job = args.job

  const baseRes = await client.rawQuery<BaseRow>(
    getBaseRowsSQL(args.hasLine, args.hasCustomer, args.hasSpec, args.hasJob),
    baseParams,
    'kdw'
  )
  const baseRows = baseRes.data ?? []
  if (baseRows.length === 0) return []

  const jobs = [...new Set(baseRows.map((r) => String(r.jobNumber ?? '')).filter((j) => j.length > 0))]

  // Step 2: fetch machine counts from KDW + cost estimates + routing steps from ESP
  // Batch jobs to avoid massive IN clauses that time out on large date ranges
  const JOB_BATCH_SIZE = 500
  const machineCountByJob = new Map<string, number>()
  const costByJob = new Map<string, {
    preMat: number; preLab: number; preFrt: number
    postMat: number; postLab: number; postFrt: number
  }>()
  const routingByJob = new Map<string, { runRate: number; setupMins: number }[]>()

  for (let i = 0; i < jobs.length; i += JOB_BATCH_SIZE) {
    const batch = jobs.slice(i, i + JOB_BATCH_SIZE)
    const espInClause = buildStringInClause('o.jobnumber', batch, `jobEsp${i}`)
    const kdwInClause = buildStringInClause('po.job_number', batch, `jobKdw${i}`)

    const [machineRes, costRes, routingRes] = await Promise.all([
      client.rawQuery<MachineCountRow>(getMachineCountsSQL(kdwInClause.clause), kdwInClause.params, 'kdw'),
      client.rawQuery<CostEstimateRow>(getCostEstimatesSQL(espInClause.clause), espInClause.params, 'esp'),
      client.rawQuery<RoutingStepRow>(getRoutingStepsSQL(espInClause.clause), espInClause.params, 'esp'),
    ])

    for (const row of machineRes.data ?? []) {
      machineCountByJob.set(String(row.jobNumber ?? ''), toNumber(row.machineCount))
    }
    for (const row of costRes.data ?? []) {
      costByJob.set(String(row.jobNumber ?? ''), {
        preMat: toNumber(row.preMaterialCostPerUnit),
        preLab: toNumber(row.preLaborCostPerUnit),
        preFrt: toNumber(row.preFreightCostPerUnit),
        postMat: toNumber(row.postMaterialCostPerUnit),
        postLab: toNumber(row.postLaborCostPerUnit),
        postFrt: toNumber(row.postFreightCostPerUnit),
      })
    }
    for (const row of routingRes.data ?? []) {
      const job = String(row.jobNumber ?? '')
      const steps = routingByJob.get(job) ?? []
      steps.push({ runRate: toNumber(row.runRate), setupMins: toNumber(row.setupMins) })
      routingByJob.set(job, steps)
    }
  }

  // Step 4a: compute total sheets fed per job (for estimated hours)
  const totalSheetsFedByJob = new Map<string, number>()
  const totalAdjQtyByJob = new Map<string, number>()
  for (const row of baseRows) {
    const jobNumber = String(row.jobNumber ?? '')
    const machineCount = machineCountByJob.get(jobNumber) ?? 0
    const qtyProduced = toNullableNumber(row.quantityProduced)
    const adjQty = qtyProduced !== null && machineCount > 0 ? qtyProduced / machineCount : 0
    const numberOut = toNumber((row as unknown as Record<string, unknown>).numberOut) || 1
    const sheetsFed = adjQty / numberOut
    totalSheetsFedByJob.set(jobNumber, (totalSheetsFedByJob.get(jobNumber) ?? 0) + sheetsFed)
    totalAdjQtyByJob.set(jobNumber, (totalAdjQtyByJob.get(jobNumber) ?? 0) + adjQty)
  }

  // Step 4b: compute total estimated hours per job (setup counted once, run hours based on sheets fed)
  const totalEstHoursByJob = new Map<string, number>()
  for (const [jobNumber, totalSheetsFed] of totalSheetsFedByJob) {
    const routingSteps = routingByJob.get(jobNumber)
    if (!routingSteps || totalSheetsFed <= 0) continue
    let totalEstHours = 0
    for (const step of routingSteps) {
      if (step.runRate <= 0) continue
      const setupHours = step.setupMins / 60
      const runHours = (1000 / step.runRate) * (totalSheetsFed / 1000)
      totalEstHours += setupHours + runHours
    }
    totalEstHoursByJob.set(jobNumber, totalEstHours)
  }

  // Step 4c: compute cost variance rows, distributing est hours proportionally by sheets fed
  const result: ComputedRow[] = []
  for (const row of baseRows) {
    const jobNumber = String(row.jobNumber ?? '')
    const machineCount = machineCountByJob.get(jobNumber) ?? 0
    const qtyProduced = toNullableNumber(row.quantityProduced)
    const adjQty = qtyProduced !== null && machineCount > 0 ? qtyProduced / machineCount : 0
    const numberOut = toNumber((row as unknown as Record<string, unknown>).numberOut) || 1
    const sheetsFed = adjQty / numberOut

    const costs = costByJob.get(jobNumber)

    // Distribute job-level estimated hours proportionally by this row's share of total sheets fed
    const totalSheetsFed = totalSheetsFedByJob.get(jobNumber) ?? 0
    const totalEstHours = totalEstHoursByJob.get(jobNumber) ?? 0
    const estimatedHours = totalSheetsFed > 0 ? (sheetsFed / totalSheetsFed) * totalEstHours : 0

    // Routing info for display (primary step run rate, total setup)
    const routingSteps = routingByJob.get(jobNumber) ?? []
    const primaryStep = routingSteps.length > 0 ? routingSteps[0] : null
    const stdRunRate = primaryStep?.runRate ?? 0
    const totalSetupMins = routingSteps.reduce((s, step) => s + step.setupMins, 0)

    result.push({
      feedbackDate: toDateKey(row.feedbackDate),
      jobNumber,
      customerName: String(row.customerName ?? 'Unknown'),
      specNumber: String(row.specNumber ?? ''),
      lineNumber: String(row.lineNumber ?? ''),
      orderHours: toNumber(row.orderHours),
      uptimeHours: toNumber(row.uptimeHours),
      estimatedHours,
      adjQty,
      stdRunRate,
      setupMins: totalSetupMins,
      estMaterialCost: (costs?.preMat ?? 0) * adjQty,
      estLaborCost: (costs?.preLab ?? 0) * adjQty,
      estFreightCost: (costs?.preFrt ?? 0) * adjQty,
      actMaterialCost: (costs?.postMat ?? 0) * adjQty,
      actLaborCost: (costs?.postLab ?? 0) * adjQty,
      actFreightCost: (costs?.postFrt ?? 0) * adjQty,
      numberOut: toNumber((row as unknown as Record<string, unknown>).numberOut) || 1,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Filter options (KDW-only, reuse sqft pattern)
// ---------------------------------------------------------------------------

function getDateLimitsSQL() {
  return `
    SELECT
      CONVERT(VARCHAR(10), MIN(CAST(pf.feedback_report_date AS DATE)), 23) as minDate,
      CONVERT(VARCHAR(10), MAX(CAST(pf.feedback_report_date AS DATE)), 23) as maxDate
    ${kdwFromClause(false, false, false, false)}
  `
}

function getLineOptionsSQL(hasCustomer: boolean, hasSpec: boolean) {
  return `
    SELECT DISTINCT
      CAST(cc.costcenter_number AS VARCHAR(3)) as lineNumber
    ${kdwFromClause(false, hasCustomer, hasSpec)}
    ORDER BY lineNumber
  `
}

function getCustomerOptionsSQL(hasLine: boolean, hasSpec: boolean) {
  return `
    SELECT DISTINCT
      ISNULL(po.customer_name, 'Unknown') as customerName
    ${kdwFromClause(hasLine, false, hasSpec)}
    ORDER BY customerName
  `
}

function getSpecOptionsSQL(hasLine: boolean, hasCustomer: boolean) {
  return `
    SELECT DISTINCT
      ISNULL(po.spec_number, '') as specNumber
    ${kdwFromClause(hasLine, hasCustomer, false)}
      AND po.spec_number IS NOT NULL
      AND po.spec_number <> ''
    ORDER BY specNumber
  `
}

function getJobOptionsSQL(hasLine: boolean, hasCustomer: boolean, hasSpec: boolean) {
  return `
    SELECT DISTINCT
      ISNULL(po.job_number, '') as jobNumber
    ${kdwFromClause(hasLine, hasCustomer, hasSpec)}
      AND po.job_number IS NOT NULL
      AND po.job_number <> ''
    ORDER BY jobNumber
  `
}

function parseDashboardFilters(c: {
  req: { query: (name: string) => string | undefined }
}) {
  const line = c.req.query('line') || ''
  const customer = c.req.query('customer') || ''
  const spec = c.req.query('spec') || ''
  const job = c.req.query('job') || ''
  return {
    line,
    customer,
    spec,
    job,
    hasLine: line.length > 0,
    hasCustomer: customer.length > 0,
    hasSpec: spec.length > 0,
    hasJob: job.length > 0,
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
// Route handlers
// ---------------------------------------------------------------------------

// GET /api/erp/cost-variance/date-limits
costVarianceDashboardRoutes.get('/date-limits', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'cost-variance:date-limits', CacheTTL.DATE_LIMITS, () =>
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

// GET /api/erp/cost-variance/summary?startDate=&endDate=&granularity=&line=&customer=&spec=
costVarianceDashboardRoutes.get('/summary', async (c) => {
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

  const { line, customer, spec, job, hasLine, hasCustomer, hasSpec, hasJob } = parseDashboardFilters(c)

  try {
    const rows = await computeCostVarianceRows(client, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      line, customer, spec, job, hasLine, hasCustomer, hasSpec, hasJob,
    })

    // Aggregate by period
    type PeriodAgg = {
      estMaterialCost: number; estLaborCost: number; estFreightCost: number
      actMaterialCost: number; actLaborCost: number; actFreightCost: number
      orderHours: number; uptimeHours: number; estimatedHours: number
    }
    const byPeriod = new Map<string, PeriodAgg>()
    for (const row of rows) {
      const period = getPeriodKey(row.feedbackDate, granularity)
      const agg = byPeriod.get(period) ?? {
        estMaterialCost: 0, estLaborCost: 0, estFreightCost: 0,
        actMaterialCost: 0, actLaborCost: 0, actFreightCost: 0,
        orderHours: 0, uptimeHours: 0, estimatedHours: 0,
      }
      agg.estMaterialCost += row.estMaterialCost
      agg.estLaborCost += row.estLaborCost
      agg.estFreightCost += row.estFreightCost
      agg.actMaterialCost += row.actMaterialCost
      agg.actLaborCost += row.actLaborCost
      agg.actFreightCost += row.actFreightCost
      agg.orderHours += row.orderHours
      agg.uptimeHours += row.uptimeHours
      agg.estimatedHours += row.estimatedHours
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

// GET /api/erp/cost-variance/details?startDate=&endDate=&line=&customer=&spec=
costVarianceDashboardRoutes.get('/details', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, job, hasLine, hasCustomer, hasSpec, hasJob } = parseDashboardFilters(c)
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10))
  const pageSize = Math.min(500, Math.max(1, parseInt(c.req.query('pageSize') || '100', 10)))
  const sortField = c.req.query('sortField') || 'feedbackDate'
  const sortDir = (c.req.query('sortDir') || 'desc') as 'asc' | 'desc'

  try {
    const rows = await computeCostVarianceRows(client, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      line, customer, spec, job, hasLine, hasCustomer, hasSpec, hasJob,
    })

    // Aggregate by date+job+customer+spec+line
    type DetailAgg = ComputedRow
    const byDetail = new Map<string, DetailAgg>()
    for (const row of rows) {
      const key = [row.feedbackDate, row.jobNumber, row.customerName, row.specNumber, row.lineNumber].join('|')
      const existing = byDetail.get(key)
      if (!existing) {
        byDetail.set(key, { ...row })
      } else {
        existing.orderHours += row.orderHours
        existing.uptimeHours += row.uptimeHours
        existing.estimatedHours += row.estimatedHours
        existing.adjQty += row.adjQty
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
        case 'hoursVariance': return r.orderHours - r.estimatedHours
        case 'vsUptime': return r.uptimeHours - r.estimatedHours
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
      orderHours: 0, uptimeHours: 0, estimatedHours: 0, adjQty: 0, quantity: 0, sheetsFed: 0,
    }
    for (const r of allData) {
      totals.estMaterialCost += r.estMaterialCost
      totals.estLaborCost += r.estLaborCost
      totals.estFreightCost += r.estFreightCost
      totals.actMaterialCost += r.actMaterialCost
      totals.actLaborCost += r.actLaborCost
      totals.actFreightCost += r.actFreightCost
      totals.orderHours += r.orderHours
      totals.uptimeHours += r.uptimeHours
      totals.estimatedHours += r.estimatedHours
      totals.adjQty += r.adjQty
      totals.sheetsFed += r.numberOut > 0 ? Math.round(r.adjQty / r.numberOut) : 0
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

// GET /api/erp/cost-variance/filter-options?startDate=&endDate=&line=&customer=&spec=&job=
costVarianceDashboardRoutes.get('/filter-options', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, job, hasLine, hasCustomer, hasSpec, hasJob: _hasJob } = parseDashboardFilters(c)

  try {
    const kv = c.env.AUTH_CACHE
    const key = cacheKey('cost-variance:filter-options', {
      s: dates.startDate, e: dates.endDate,
      l: line, c: customer, sp: spec, j: job,
    })

    const result = await kvCache(kv, key, CacheTTL.FILTER_OPTIONS, async () => {
      const lineSql = getLineOptionsSQL(hasCustomer, hasSpec)
      const customerSql = getCustomerOptionsSQL(hasLine, hasSpec)
      const specSql = getSpecOptionsSQL(hasLine, hasCustomer)
      const jobSql = getJobOptionsSQL(hasLine, hasCustomer, hasSpec)

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

      const jobParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasLine) jobParams.line = parseInt(line, 10)
      if (hasCustomer) jobParams.customer = customer
      if (hasSpec) jobParams.spec = spec

      const [linesRes, customersRes, specsRes, jobsRes] = await Promise.all([
        client.rawQuery(lineSql, lineParams, 'kdw'),
        client.rawQuery(customerSql, customerParams, 'kdw'),
        client.rawQuery(specSql, specParams, 'kdw'),
        client.rawQuery(jobSql, jobParams, 'kdw'),
      ])

      return {
        lineNumbers: ((linesRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.lineNumber ?? '')),
        customers: ((customersRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.customerName ?? '')),
        specs: ((specsRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.specNumber ?? '')),
        jobs: ((jobsRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.jobNumber ?? '')),
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


