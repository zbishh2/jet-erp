import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { requireModuleRole } from '../middleware/require-role'
import { kvCache, cacheKey, CacheTTL } from '../services/kv-cache'

export const contributionDashboardRoutes = new Hono<{ Bindings: Env }>()

// Financial dashboards require ADMIN or FINANCE role
contributionDashboardRoutes.use('*', requireModuleRole('ADMIN', 'FINANCE'))

function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

function contributionFilteredFeedbackCte(
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
    filtered_feedback AS (
      SELECT
        CAST(pf.feedback_report_date AS DATE) as feedbackDate,
        ISNULL(po.job_number, '') as jobNumber,
        ISNULL(po.customer_name, 'Unknown') as customerName,
        ISNULL(po.spec_number, '') as specNumber,
        CAST(cc.costcenter_number AS VARCHAR(3)) as lineNumber,
        CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0 as orderHours,
        TRY_CAST(pf.quantity_produced AS FLOAT) as quantityProduced,
        TRY_CAST(pf.selling_price AS FLOAT) as sellingPrice,
        TRY_CAST(po.ordered_board_cost AS FLOAT) as orderedBoardCost,
        TRY_CAST(po.ordered_quantity AS FLOAT) as orderedQuantity
      FROM dwproductionfeedback pf
      LEFT JOIN dwjobseriesstep jss
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
    )
  `
}

function contributionCalcCte(
  hasLine: boolean,
  hasCustomer: boolean,
  hasSpec: boolean,
  includeDateRange = true
) {
  return `
    WITH
    ${contributionFilteredFeedbackCte(hasLine, hasCustomer, hasSpec, includeDateRange)},
    job_machine_counts AS (
      SELECT
        po.job_number as jobNumber,
        COUNT(DISTINCT CAST(cc.costcenter_number AS VARCHAR(3))) as machineCount
      FROM dwproductionfeedback pf
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN dwproductionorders po
        ON pf.feedback_pcs_order_id = po.pcs_order_id
      WHERE po.job_number IS NOT NULL
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      GROUP BY po.job_number
    ),
    base AS (
      SELECT
        ff.feedbackDate,
        ff.jobNumber,
        ff.customerName,
        ff.specNumber,
        ff.lineNumber,
        ff.orderHours,
        ff.quantityProduced / NULLIF(TRY_CAST(jmc.machineCount AS FLOAT), 0.0) as quantityProducedPerMachine,
        COALESCE(
          NULLIF(ff.sellingPrice, 0.0),
          ff.orderedBoardCost / NULLIF(ff.orderedQuantity, 0.0)
        ) as unitPrice,
        CAST(0.0 AS FLOAT) as preFullCostPerUnit
      FROM filtered_feedback ff
      LEFT JOIN job_machine_counts jmc
        ON jmc.jobNumber = ff.jobNumber
    ),
    calc AS (
      SELECT
        base.feedbackDate,
        base.jobNumber,
        base.customerName,
        base.specNumber,
        base.lineNumber,
        base.orderHours,
        base.quantityProducedPerMachine,
        base.unitPrice,
        base.preFullCostPerUnit,
        base.quantityProducedPerMachine * base.unitPrice as calculatedValue,
        base.quantityProducedPerMachine * base.preFullCostPerUnit as estimatedFullCost,
        CASE
          WHEN (base.quantityProducedPerMachine * base.unitPrice) IS NULL THEN NULL
          ELSE (base.quantityProducedPerMachine * base.unitPrice)
            - (base.quantityProducedPerMachine * base.preFullCostPerUnit)
        END as preEstimatedContribution,
        CASE
          WHEN base.orderHours < 0.5 OR base.orderHours = 0 THEN NULL
          WHEN (base.quantityProducedPerMachine * base.unitPrice) IS NULL THEN NULL
          ELSE (
            (base.quantityProducedPerMachine * base.unitPrice)
            - (base.quantityProducedPerMachine * base.preFullCostPerUnit)
          ) / NULLIF(base.orderHours, 0)
        END as rowContributionPerOrderHour
      FROM base
    )
  `
}

function getDateLimitsSQL() {
  return `
    ${contributionCalcCte(false, false, false, false)}
    SELECT
      CONVERT(VARCHAR(10), MIN(calc.feedbackDate), 23) as minDate,
      CONVERT(VARCHAR(10), MAX(calc.feedbackDate), 23) as maxDate
    FROM calc
  `
}

function getLineOptionsSQL(hasCustomer: boolean, hasSpec: boolean) {
  return `
    WITH
    ${contributionFilteredFeedbackCte(false, hasCustomer, hasSpec)}
    SELECT DISTINCT
      ff.lineNumber
    FROM filtered_feedback ff
    ORDER BY ff.lineNumber
  `
}

function getCustomerOptionsSQL(hasLine: boolean, hasSpec: boolean) {
  return `
    WITH
    ${contributionFilteredFeedbackCte(hasLine, false, hasSpec)}
    SELECT DISTINCT
      ff.customerName
    FROM filtered_feedback ff
    ORDER BY ff.customerName
  `
}

function getSpecOptionsSQL(hasLine: boolean, hasCustomer: boolean) {
  return `
    WITH
    ${contributionFilteredFeedbackCte(hasLine, hasCustomer, false)}
    SELECT DISTINCT
      ff.specNumber
    FROM filtered_feedback ff
    WHERE ff.specNumber <> ''
    ORDER BY ff.specNumber
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

type ContributionBaseRow = {
  feedbackDate: unknown
  jobNumber: unknown
  customerName: unknown
  specNumber: unknown
  lineNumber: unknown
  orderHours: unknown
  quantityProduced: unknown
  sellingPrice: unknown
}

type JobMetricRow = {
  jobNumber: unknown
  unitPriceInvoiceAvg: unknown
  preFullCostPerUnit: unknown
}

type JobMachineCountRow = {
  jobNumber: unknown
  machineCount: unknown
}

type ContributionCalcRow = {
  feedbackDate: string
  jobNumber: string
  customerName: string
  specNumber: string
  lineNumber: string
  orderHours: number
  calculatedValue: number | null
  estimatedFullCost: number | null
  contribution: number | null
  rowContributionPerOrderHour: number | null
}

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

function periodKeyFromDate(dateKey: string, granularity: string): string {
  if (granularity === 'daily') return dateKey
  if (granularity === 'yearly') return dateKey.slice(0, 4)
  if (granularity === 'monthly') return dateKey.slice(0, 7)

  // weekly: align to Monday start
  const [y, m, d] = dateKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  const dayOfWeek = dt.getUTCDay() // 0=Sun
  dt.setUTCDate(dt.getUTCDate() - ((dayOfWeek + 6) % 7)) // rewind to Monday
  return dt.toISOString().slice(0, 10)
}

function buildStringInClause(column: string, values: string[], prefix: string) {
  const unique = [...new Set(values.filter((v) => v.length > 0))]
  if (unique.length === 0) {
    return {
      clause: '1 = 0',
      params: {} as Record<string, unknown>,
    }
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

function getContributionBaseRowsSQL(hasLine: boolean, hasCustomer: boolean, hasSpec: boolean) {
  return `
    WITH
    ${contributionFilteredFeedbackCte(hasLine, hasCustomer, hasSpec)}
    SELECT
      ff.feedbackDate,
      ff.jobNumber,
      ff.customerName,
      ff.specNumber,
      ff.lineNumber,
      ff.orderHours,
      ff.quantityProduced,
      ff.sellingPrice
    FROM filtered_feedback ff
  `
}

function getJobMachineCountsSQL(jobClause: string) {
  return `
    SELECT
      po.job_number as jobNumber,
      COUNT(DISTINCT CAST(cc.costcenter_number AS VARCHAR(3))) as machineCount
    FROM dwproductionfeedback pf
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN dwproductionorders po
      ON pf.feedback_pcs_order_id = po.pcs_order_id
    WHERE po.job_number IS NOT NULL
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      AND ${jobClause}
    GROUP BY po.job_number
  `
}

function getJobMetricsSQL(jobClause: string) {
  return `
    SELECT
      o.jobnumber as jobNumber,
      AVG(
        CASE
          WHEN il.invoiceLineType = 'Goods Invoice Line'
          THEN TRY_CAST(il.totalvalue AS FLOAT) / NULLIF(TRY_CAST(il.quantity AS FLOAT), 0)
          ELSE NULL
        END
      ) as unitPriceInvoiceAvg,
      MAX(
        CASE
          WHEN ce.fullcost IS NULL THEN NULL
          ELSE TRY_CAST(ce.fullcost AS FLOAT) / 1000.0
        END
      ) as preFullCostPerUnit
    FROM dbo.espOrder o
    LEFT JOIN dbo.espInvoiceLine il
      ON il.orderID = o.ID
    LEFT JOIN dbo.cstCostEstimate ce
      ON o.precostestimateID = ce.ID
    WHERE ${jobClause}
    GROUP BY o.jobnumber
  `
}

async function computeContributionRows(
  client: ReturnType<typeof createKiwiplanClient>,
  args: {
    startDate: string
    endDate: string
    line: string
    customer: string
    spec: string
    hasLine: boolean
    hasCustomer: boolean
    hasSpec: boolean
  }
): Promise<{ rows: ContributionCalcRow[]; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {}
  const baseParams: Record<string, unknown> = {
    startDate: args.startDate,
    endDate: args.endDate,
  }
  if (args.hasLine) baseParams.line = parseInt(args.line, 10)
  if (args.hasCustomer) baseParams.customer = args.customer
  if (args.hasSpec) baseParams.spec = args.spec

  const baseRowsRes = await client.rawQuery<ContributionBaseRow>(
    getContributionBaseRowsSQL(args.hasLine, args.hasCustomer, args.hasSpec),
    baseParams,
    'kdw'
  )
  const baseRows = baseRowsRes.data ?? []
  const jobs = [...new Set(baseRows.map((r) => String(r.jobNumber ?? '')).filter((j) => j.length > 0))]

  const [machineRes, jobMetricsRes] = await Promise.all([
    jobs.length > 0
      ? (() => {
          const jobIn = buildStringInClause('po.job_number', jobs, 'jobKdw')
          return client.rawQuery<JobMachineCountRow>(getJobMachineCountsSQL(jobIn.clause), jobIn.params, 'kdw')
        })()
      : Promise.resolve({ data: [] as JobMachineCountRow[] }),
    jobs.length > 0
      ? (() => {
          const espJobIn = buildStringInClause('o.jobnumber', jobs, 'jobEsp')
          return client.rawQuery<JobMetricRow>(getJobMetricsSQL(espJobIn.clause), espJobIn.params, 'esp')
        })()
      : Promise.resolve({ data: [] as JobMetricRow[] }),
  ])

  const machineCountByJob = new Map<string, number>()
  for (const row of machineRes.data ?? []) {
    machineCountByJob.set(String(row.jobNumber ?? ''), toNumber(row.machineCount))
  }

  const jobMetricByJob = new Map<string, { unitPriceInvoiceAvg: number | null; preFullCostPerUnit: number | null }>()
  for (const row of jobMetricsRes.data ?? []) {
    jobMetricByJob.set(String(row.jobNumber ?? ''), {
      unitPriceInvoiceAvg: toNullableNumber(row.unitPriceInvoiceAvg),
      preFullCostPerUnit: toNullableNumber(row.preFullCostPerUnit),
    })
  }

  // Compute within-dataset spec averages: for each spec, average the invoice prices
  // of other jobs sharing the same spec that DO have invoice data
  const specJobs = new Map<string, Set<string>>()
  for (const row of baseRows) {
    const spec = String(row.specNumber ?? '')
    const job = String(row.jobNumber ?? '')
    if (!spec || !job) continue
    if (!specJobs.has(spec)) specJobs.set(spec, new Set())
    specJobs.get(spec)!.add(job)
  }

  const specAvg = new Map<string, number | null>()
  for (const [spec, jobSet] of specJobs) {
    let sum = 0
    let count = 0
    for (const job of jobSet) {
      const metric = jobMetricByJob.get(job)
      if (metric?.unitPriceInvoiceAvg != null) {
        sum += metric.unitPriceInvoiceAvg
        count++
      }
    }
    specAvg.set(spec, count > 0 ? sum / count : null)
  }

  const specs = [...new Set(baseRows.map((r) => String(r.specNumber ?? '')).filter((s) => s.length > 0))]
  const specsWithPrice = specs.filter((s) => specAvg.get(s) != null)
  const specsNeedingFallback = specs.filter((s) => specAvg.get(s) == null)
  debug.baseRowCount = baseRows.length
  debug.uniqueJobs = jobs.length
  debug.uniqueSpecs = specs.length
  debug.specsWithDatasetPrice = specsWithPrice.length
  debug.specsNeedingFallback = specsNeedingFallback.length
  debug.jobsWithInvoiceAvg = [...jobMetricByJob.values()].filter((m) => m.unitPriceInvoiceAvg != null).length
  const historicalSpecAvg = new Map<string, number | null>()

  if (specsNeedingFallback.length > 0) {
    try {
      // Step 1: Get spec→job from KDW using same join pattern as base rows (with costcenter filter for index use)
      const specIn = buildStringInClause('po.spec_number', specsNeedingFallback, 'specKdw')
      const specJobsRes = await client.rawQuery<{ specNumber: unknown; jobNumber: unknown }>(
        `SELECT DISTINCT po.spec_number as specNumber, po.job_number as jobNumber
         FROM dwproductionfeedback pf
         INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
         INNER JOIN dwproductionorders po ON pf.feedback_pcs_order_id = po.pcs_order_id
         WHERE cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
           AND po.job_number IS NOT NULL
           AND ${specIn.clause}`,
        specIn.params,
        'kdw'
      )

      // Build additional jobs set
      const fallbackSpecJobs = new Map<string, string[]>()
      const additionalJobs = new Set<string>()
      for (const row of specJobsRes.data ?? []) {
        const spec = String(row.specNumber ?? '')
        const job = String(row.jobNumber ?? '')
        if (!spec || !job) continue
        if (!fallbackSpecJobs.has(spec)) fallbackSpecJobs.set(spec, [])
        fallbackSpecJobs.get(spec)!.push(job)
        if (!jobMetricByJob.has(job)) additionalJobs.add(job)
      }
      debug.fallbackSpecJobPairs = (specJobsRes.data ?? []).length
      debug.additionalJobsNeeded = additionalJobs.size

      // Step 2: Get ESP invoice prices for additional jobs
      const additionalJobList = [...additionalJobs].slice(0, 3000)
      if (additionalJobList.length > 0) {
        const espJobIn = buildStringInClause('o.jobnumber', additionalJobList, 'jobExtra')
        const extraRes = await client.rawQuery<JobMetricRow>(
          getJobMetricsSQL(espJobIn.clause), espJobIn.params, 'esp'
        )
        for (const row of extraRes.data ?? []) {
          jobMetricByJob.set(String(row.jobNumber ?? ''), {
            unitPriceInvoiceAvg: toNullableNumber(row.unitPriceInvoiceAvg),
            preFullCostPerUnit: toNullableNumber(row.preFullCostPerUnit),
          })
        }
      }

      // Step 3: Compute spec averages from job data
      for (const [spec, specJobList] of fallbackSpecJobs) {
        let sum = 0
        let count = 0
        for (const job of specJobList) {
          const metric = jobMetricByJob.get(job)
          if (metric?.unitPriceInvoiceAvg != null) {
            sum += metric.unitPriceInvoiceAvg
            count++
          }
        }
        historicalSpecAvg.set(spec, count > 0 ? sum / count : null)
      }
      debug.historicalSpecsResolved = [...historicalSpecAvg.values()].filter((v) => v != null).length
    } catch (e) {
      debug.fallbackError = String(e)
    }
  }

  // Second fallback: for specs STILL unresolved, query dwproductionorders directly
  // (bypasses feedback table — gets ALL jobs for a spec, not just corrugator jobs)
  const stillUnresolved = specsNeedingFallback.filter(
    (s) => (specAvg.get(s) ?? historicalSpecAvg.get(s) ?? null) === null
  )
  debug.specsStillUnresolved = stillUnresolved.length

  if (stillUnresolved.length > 0) {
    try {
      const specIn2 = buildStringInClause('spec_number', stillUnresolved, 'specDirect')
      const directSpecJobsRes = await client.rawQuery<{ specNumber: unknown; jobNumber: unknown }>(
        `SELECT DISTINCT spec_number as specNumber, job_number as jobNumber
         FROM dwproductionorders
         WHERE job_number IS NOT NULL
           AND ${specIn2.clause}`,
        specIn2.params,
        'kdw'
      )

      const directFallbackJobs = new Map<string, string[]>()
      const directAdditionalJobs = new Set<string>()
      for (const row of directSpecJobsRes.data ?? []) {
        const spec = String(row.specNumber ?? '')
        const job = String(row.jobNumber ?? '')
        if (!spec || !job) continue
        if (!directFallbackJobs.has(spec)) directFallbackJobs.set(spec, [])
        directFallbackJobs.get(spec)!.push(job)
        if (!jobMetricByJob.has(job)) directAdditionalJobs.add(job)
      }
      debug.directFallbackPairs = (directSpecJobsRes.data ?? []).length
      debug.directAdditionalJobs = directAdditionalJobs.size

      const directJobList = [...directAdditionalJobs].slice(0, 3000)
      if (directJobList.length > 0) {
        const espJobIn2 = buildStringInClause('o.jobnumber', directJobList, 'jobDirect')
        const extraRes2 = await client.rawQuery<JobMetricRow>(
          getJobMetricsSQL(espJobIn2.clause), espJobIn2.params, 'esp'
        )
        for (const row of extraRes2.data ?? []) {
          jobMetricByJob.set(String(row.jobNumber ?? ''), {
            unitPriceInvoiceAvg: toNullableNumber(row.unitPriceInvoiceAvg),
            preFullCostPerUnit: toNullableNumber(row.preFullCostPerUnit),
          })
        }
      }

      for (const [spec, specJobList] of directFallbackJobs) {
        let sum = 0
        let count = 0
        for (const job of specJobList) {
          const metric = jobMetricByJob.get(job)
          if (metric?.unitPriceInvoiceAvg != null) {
            sum += metric.unitPriceInvoiceAvg
            count++
          }
        }
        if (count > 0) historicalSpecAvg.set(spec, sum / count)
      }
      debug.directSpecsResolved = stillUnresolved.filter(
        (s) => historicalSpecAvg.get(s) != null
      ).length
    } catch (e) {
      debug.directFallbackError = String(e)
    }
  }

  const calcRows: ContributionCalcRow[] = []
  for (const row of baseRows) {
    const jobNumber = String(row.jobNumber ?? '')
    const specNumber = String(row.specNumber ?? '')
    const machineCount = machineCountByJob.get(jobNumber) ?? 0
    const quantityProduced = toNullableNumber(row.quantityProduced)
    const quantityProducedPerMachine =
      quantityProduced !== null && machineCount > 0
        ? quantityProduced / machineCount
        : null

    const jobMetric = jobMetricByJob.get(jobNumber)
    // Fallback chain: job invoice avg → dataset spec avg → historical spec avg → null
    const unitPrice =
      jobMetric?.unitPriceInvoiceAvg
      ?? specAvg.get(specNumber)
      ?? historicalSpecAvg.get(specNumber)
      ?? null

    const preFullCostPerUnit = jobMetric?.preFullCostPerUnit ?? 0
    const orderHours = toNumber(row.orderHours)

    const calculatedValue =
      quantityProducedPerMachine !== null && unitPrice !== null
        ? quantityProducedPerMachine * unitPrice
        : null
    const estimatedFullCost =
      quantityProducedPerMachine !== null
        ? quantityProducedPerMachine * preFullCostPerUnit
        : null
    const contribution =
      calculatedValue === null
        ? null
        : calculatedValue - (estimatedFullCost ?? 0)
    const rowContributionPerOrderHour =
      contribution === null || orderHours < 0.5 || orderHours === 0
        ? null
        : contribution / orderHours

    calcRows.push({
      feedbackDate: toDateKey(row.feedbackDate),
      jobNumber,
      customerName: String(row.customerName ?? 'Unknown'),
      specNumber,
      lineNumber: String(row.lineNumber ?? ''),
      orderHours,
      calculatedValue,
      estimatedFullCost,
      contribution,
      rowContributionPerOrderHour,
    })
  }

  // Final debug stats
  let nullCalcValue = 0, nullUnitPrice = 0, nullQtyPerMachine = 0, zeroMachineCount = 0
  for (const r of calcRows) {
    if (r.calculatedValue === null) nullCalcValue++
  }
  for (const row of baseRows) {
    const jn = String(row.jobNumber ?? '')
    const sn = String(row.specNumber ?? '')
    const jm = jobMetricByJob.get(jn)
    const up = jm?.unitPriceInvoiceAvg ?? specAvg.get(sn) ?? historicalSpecAvg.get(sn) ?? null
    if (up === null) nullUnitPrice++
    const mc = machineCountByJob.get(jn) ?? 0
    if (mc === 0) zeroMachineCount++
    const qp = toNullableNumber(row.quantityProduced)
    if (qp === null || mc === 0) nullQtyPerMachine++
  }
  debug.rowsWithNullCalcValue = nullCalcValue
  debug.rowsWithNullUnitPrice = nullUnitPrice
  debug.rowsWithZeroMachineCount = zeroMachineCount
  debug.rowsWithNullQtyPerMachine = nullQtyPerMachine

  // Aggregate debug: totals to compare against PBIP
  let totalCalcValue = 0, totalQtyRaw = 0, totalQtyPerMachine = 0, totalOrderHours = 0
  let avgMachineCountSum = 0, avgMachineCountN = 0, avgUnitPriceSum = 0, avgUnitPriceN = 0
  for (const r of calcRows) {
    totalCalcValue += r.calculatedValue ?? 0
    totalOrderHours += r.orderHours
  }
  for (const row of baseRows) {
    const jn = String(row.jobNumber ?? '')
    const qp = toNullableNumber(row.quantityProduced)
    totalQtyRaw += qp ?? 0
    const mc = machineCountByJob.get(jn) ?? 0
    if (mc > 0 && qp !== null) {
      totalQtyPerMachine += qp / mc
      avgMachineCountSum += mc
      avgMachineCountN++
    }
    const sn = String(row.specNumber ?? '')
    const jm = jobMetricByJob.get(jn)
    const up = jm?.unitPriceInvoiceAvg ?? specAvg.get(sn) ?? historicalSpecAvg.get(sn) ?? null
    if (up !== null) {
      avgUnitPriceSum += up
      avgUnitPriceN++
    }
  }
  debug.totalCalcValue = Math.round(totalCalcValue)
  debug.totalQtyRaw = Math.round(totalQtyRaw)
  debug.totalQtyPerMachine = Math.round(totalQtyPerMachine)
  debug.totalOrderHours = Math.round(totalOrderHours * 100) / 100
  debug.avgMachineCount = avgMachineCountN > 0 ? Math.round((avgMachineCountSum / avgMachineCountN) * 100) / 100 : null
  debug.avgUnitPrice = avgUnitPriceN > 0 ? Math.round((avgUnitPriceSum / avgUnitPriceN) * 100) / 100 : null

  return { rows: calcRows, debug }
}

// GET /api/erp/contribution/date-limits
contributionDashboardRoutes.get('/date-limits', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'contribution:date-limits', CacheTTL.DATE_LIMITS, () =>
      client.rawQuery(getDateLimitsSQL(), {}, 'kdw')
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    console.error('[contribution]', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// GET /api/erp/contribution/summary?startDate=&endDate=&granularity=&line=&customer=&spec=
contributionDashboardRoutes.get('/summary', async (c) => {
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
    const { rows, debug: _debug } = await computeContributionRows(client, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      line,
      customer,
      spec,
      hasLine,
      hasCustomer,
      hasSpec,
    })

    type SummaryAgg = {
      calculatedValue: number
      contribution: number
      orderHours: number
      daySet: Set<string>
    }

    const byPeriod = new Map<string, SummaryAgg>()
    for (const row of rows) {
      const period = periodKeyFromDate(row.feedbackDate, granularity)
      const existing = byPeriod.get(period) ?? {
        calculatedValue: 0,
        contribution: 0,
        orderHours: 0,
        daySet: new Set<string>(),
      }

      existing.calculatedValue += row.calculatedValue ?? 0
      existing.contribution += row.contribution ?? 0
      existing.orderHours += row.orderHours
      existing.daySet.add(row.feedbackDate)

      byPeriod.set(period, existing)
    }

    const data = [...byPeriod.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, agg]) => {
        return {
          period,
          calculatedValue: agg.calculatedValue,
          contribution: agg.contribution,
          orderHours: agg.orderHours,
          contributionPerOrderHour:
            agg.orderHours === 0 ? null : agg.contribution / agg.orderHours,
          contributionPct:
            agg.calculatedValue === 0 ? null : agg.contribution / agg.calculatedValue,
          dayCount: agg.daySet.size,
        }
      })

    return c.json({ data })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    console.error('[contribution]', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// GET /api/erp/contribution/by-line?startDate=&endDate=&line=&customer=&spec=
contributionDashboardRoutes.get('/by-line', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const { rows, debug: _debug } = await computeContributionRows(client, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      line,
      customer,
      spec,
      hasLine,
      hasCustomer,
      hasSpec,
    })

    type ByLineAgg = {
      lineNumber: string
      calculatedValue: number
      contribution: number
      orderHours: number
      rowContributionPerOrderHourSum: number
      rowContributionPerOrderHourCount: number
    }

    const byLine = new Map<string, ByLineAgg>()
    for (const row of rows) {
      const key = row.lineNumber
      const existing = byLine.get(key) ?? {
        lineNumber: key,
        calculatedValue: 0,
        contribution: 0,
        orderHours: 0,
        rowContributionPerOrderHourSum: 0,
        rowContributionPerOrderHourCount: 0,
      }

      existing.calculatedValue += row.calculatedValue ?? 0
      existing.contribution += row.contribution ?? 0
      existing.orderHours += row.orderHours
      if (row.rowContributionPerOrderHour !== null) {
        existing.rowContributionPerOrderHourSum += row.rowContributionPerOrderHour
        existing.rowContributionPerOrderHourCount += 1
      }

      byLine.set(key, existing)
    }

    const data = [...byLine.values()]
      .map((agg) => {
        const contributionPerOrderHour =
          agg.orderHours > 0
            ? agg.contribution / agg.orderHours
            : null
        return {
          lineNumber: agg.lineNumber,
          calculatedValue: agg.calculatedValue,
          contribution: agg.contribution,
          orderHours: agg.orderHours,
          contributionPerOrderHour,
          contributionPct:
            agg.calculatedValue === 0 ? null : agg.contribution / agg.calculatedValue,
        }
      })
      .sort((a, b) => {
        const aVal = a.contributionPerOrderHour ?? Number.NEGATIVE_INFINITY
        const bVal = b.contributionPerOrderHour ?? Number.NEGATIVE_INFINITY
        return bVal - aVal
      })

    return c.json({ data })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    console.error('[contribution]', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// GET /api/erp/contribution/details?startDate=&endDate=&line=&customer=&spec=
contributionDashboardRoutes.get('/details', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const { rows, debug: _debug } = await computeContributionRows(client, {
      startDate: dates.startDate,
      endDate: dates.endDate,
      line,
      customer,
      spec,
      hasLine,
      hasCustomer,
      hasSpec,
    })

    type DetailAgg = {
      feedbackDate: string
      jobNumber: string
      customerName: string
      specNumber: string
      lineNumber: string
      calculatedValue: number
      estimatedFullCost: number
      contribution: number
      orderHours: number
      rowContributionPerOrderHourSum: number
      rowContributionPerOrderHourCount: number
    }

    const byDetail = new Map<string, DetailAgg>()
    for (const row of rows) {
      const key = [
        row.feedbackDate,
        row.jobNumber,
        row.customerName,
        row.specNumber,
        row.lineNumber,
      ].join('|')

      const existing = byDetail.get(key) ?? {
        feedbackDate: row.feedbackDate,
        jobNumber: row.jobNumber,
        customerName: row.customerName,
        specNumber: row.specNumber,
        lineNumber: row.lineNumber,
        calculatedValue: 0,
        estimatedFullCost: 0,
        contribution: 0,
        orderHours: 0,
        rowContributionPerOrderHourSum: 0,
        rowContributionPerOrderHourCount: 0,
      }

      existing.calculatedValue += row.calculatedValue ?? 0
      existing.estimatedFullCost += row.estimatedFullCost ?? 0
      existing.contribution += row.contribution ?? 0
      existing.orderHours += row.orderHours
      if (row.rowContributionPerOrderHour !== null) {
        existing.rowContributionPerOrderHourSum += row.rowContributionPerOrderHour
        existing.rowContributionPerOrderHourCount += 1
      }

      byDetail.set(key, existing)
    }

    const data = [...byDetail.values()]
      .map((agg) => {
        const contributionPerOrderHour =
          agg.orderHours > 0
            ? agg.contribution / agg.orderHours
            : null
        return {
          feedbackDate: agg.feedbackDate,
          jobNumber: agg.jobNumber,
          customerName: agg.customerName,
          specNumber: agg.specNumber,
          lineNumber: agg.lineNumber,
          calculatedValue: agg.calculatedValue,
          estimatedFullCost: agg.estimatedFullCost,
          contribution: agg.contribution,
          orderHours: agg.orderHours,
          contributionPerOrderHour,
          contributionPct:
            agg.calculatedValue === 0 ? null : agg.contribution / agg.calculatedValue,
        }
      })
      .sort((a, b) => {
        const dateCmp = b.feedbackDate.localeCompare(a.feedbackDate)
        if (dateCmp !== 0) return dateCmp
        return b.jobNumber.localeCompare(a.jobNumber)
      })

    return c.json({ data })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    console.error('[contribution]', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})

// GET /api/erp/contribution/filter-options?startDate=&endDate=&line=&customer=&spec=
contributionDashboardRoutes.get('/filter-options', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const dates = requireDates(c)
  if ('error' in dates) return dates.error

  const { line, customer, spec, hasLine, hasCustomer, hasSpec } = parseDashboardFilters(c)

  try {
    const kv = c.env.AUTH_CACHE
    const key = cacheKey('contribution:filter-options', {
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
    console.error('[contribution]', err)
    return c.json({ error: 'Internal server error' }, 500)
  }
})
