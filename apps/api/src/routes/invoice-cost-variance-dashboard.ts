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
  const job = c.req.query('job') || ''
  return {
    customer,
    spec,
    salesRep,
    job,
    hasCustomer: customer.length > 0,
    hasSpec: spec.length > 0,
    hasSalesRep: salesRep.length > 0,
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
// SQL: single ESP query with all JOINs
// ---------------------------------------------------------------------------

// Lean SQL for summary/aggregation — no routing, board, or purchase cost joins
function getInvoiceCostVarianceLeanSQL(hasCustomer: boolean, hasSpec: boolean, hasSalesRep: boolean, hasJob: boolean = false) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''
  const jobWhere = hasJob ? `AND o.jobnumber = @job` : ''

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
      NULL as totalSetupHours,
      NULL as hoursPerThousand,
      NULL as stdRunRate,
      NULL as totalSetupMins,
      ISNULL(pd.noperset, 1) * ISNULL(pd.noofsets, 1) as numberOut,
      NULL as routeBoardArea,
      NULL as routeNup,
      NULL as supplierCostPerUom,
      NULL as supplierUOM,
      NULL as stdBoardCostPerMSF
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
    LEFT JOIN dbo.orgCompany cust ON COALESCE(pd.companyID, o.companyID) = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    LEFT JOIN dbo.cstCostEstimate pce ON o.precostestimateID = pce.ID
    OUTER APPLY (
      SELECT TOP 1 pco2.costEstimateID
      FROM dbo.ocsPostcostedorder pco2
      WHERE pco2.orderID = o.ID
      ORDER BY pco2.ID DESC
    ) pco
    LEFT JOIN dbo.cstCostEstimate postce ON pco.costEstimateID = postce.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      ${customerWhere}
      ${salesRepWhere}
      ${specWhere}
      ${jobWhere}
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
  routeBoardArea: unknown
  routeNup: unknown
  supplierCostPerUom: unknown
  supplierUOM: unknown
  stdBoardCostPerMSF: unknown
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
  jetBoardCostPerM: number | null
  jetBoardAreaSqFt: number | null
  jetBoardNup: number | null
  jetCostPerMSF: number | null
  jetCostSource: string | null
  step1Machine: string | null
  estBoardCost: number | null
  actBoardCost: number | null
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
      jetBoardCostPerM: null,
      jetBoardAreaSqFt: null,
      jetBoardNup: null,
      jetCostPerMSF: null,
      jetCostSource: null,
      step1Machine: null,
      estBoardCost: null,
      actBoardCost: null,
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

function getCustomerOptionsSQL(hasSpec: boolean, hasSalesRep: boolean = false, hasJob: boolean = false) {
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''
  const jobWhere = hasJob ? `AND o.jobnumber = @job` : ''
  return `
    SELECT DISTINCT ISNULL(cust.name, 'Unknown') as customerName
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
    LEFT JOIN dbo.orgCompany cust ON COALESCE(pd.companyID, o.companyID) = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      ${specWhere}
      ${salesRepWhere}
      ${jobWhere}
    ORDER BY customerName
  `
}

function getSalesRepOptionsSQL(hasCustomer: boolean, hasSpec: boolean, hasJob: boolean = false) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  const jobWhere = hasJob ? `AND o.jobnumber = @job` : ''
  return `
    SELECT DISTINCT ISNULL(salescon.firstname + ' ' + salescon.lastname, '') as salesRep
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
    LEFT JOIN dbo.orgCompany cust ON COALESCE(pd.companyID, o.companyID) = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') <> ''
      ${customerWhere}
      ${specWhere}
      ${jobWhere}
    ORDER BY salesRep
  `
}

function getSpecOptionsSQL(hasCustomer: boolean, hasSalesRep: boolean = false, hasJob: boolean = false) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''
  const jobWhere = hasJob ? `AND o.jobnumber = @job` : ''
  return `
    SELECT DISTINCT pd.designnumber as specNumber
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
    LEFT JOIN dbo.orgCompany cust ON COALESCE(pd.companyID, o.companyID) = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND pd.designnumber IS NOT NULL
      AND pd.designnumber <> ''
      ${customerWhere}
      ${salesRepWhere}
      ${jobWhere}
    ORDER BY specNumber
  `
}

function getJobOptionsSQL(hasCustomer: boolean, hasSpec: boolean, hasSalesRep: boolean = false) {
  const customerWhere = hasCustomer ? `AND cust.name = @customer` : ''
  const specWhere = hasSpec ? `AND pd.designnumber = @spec` : ''
  const salesRepWhere = hasSalesRep ? `AND ISNULL(salescon.firstname + ' ' + salescon.lastname, '') = @salesRep` : ''
  return `
    SELECT DISTINCT o.jobnumber as jobNumber
    FROM dbo.espInvoiceLine il
    INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
    INNER JOIN dbo.espOrder o ON il.orderID = o.ID
    LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
    LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
    LEFT JOIN dbo.orgCompany cust ON COALESCE(pd.companyID, o.companyID) = cust.ID
    LEFT JOIN dbo.orgContact salescon ON cust.salesContactID = salescon.ID
    WHERE inv.invoicestatus = 'Final'
      AND il.invoiceLineType = 'Goods Invoice Line'
      AND inv.transactiondate >= @startDate
      AND inv.transactiondate < @endDate
      AND o.jobnumber IS NOT NULL
      AND o.jobnumber <> ''
      ${customerWhere}
      ${specWhere}
      ${salesRepWhere}
    ORDER BY jobNumber
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

  const { customer, spec, salesRep, job, hasCustomer, hasSpec, hasSalesRep, hasJob } = parseDashboardFilters(c)

  try {
    const params: Record<string, unknown> = {
      startDate: dates.startDate,
      endDate: dates.endDate,
    }
    if (hasCustomer) params.customer = customer
    if (hasSpec) params.spec = spec
    if (hasSalesRep) params.salesRep = salesRep
    if (hasJob) params.job = job

    const result = await client.rawQuery<InvoiceRow>(
      getInvoiceCostVarianceLeanSQL(hasCustomer, hasSpec, hasSalesRep, hasJob),
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

  const { customer, spec, salesRep, job, hasCustomer, hasSpec, hasSalesRep, hasJob } = parseDashboardFilters(c)
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
    if (hasJob) params.job = job

    // Use lean SQL (no board/routing joins) + separate board cost lookup
    const result = await client.rawQuery<InvoiceRow>(
      getInvoiceCostVarianceLeanSQL(hasCustomer, hasSpec, hasSalesRep, hasJob),
      params,
      'esp'
    )
    const rows = computeRows(result.data ?? [])

    // Collect unique specs, then batch-fetch board costs
    const specSet = new Set(rows.map(r => r.specNumber).filter(Boolean))
    interface BoardCostInfo {
      costPerM: number
      boardAreaSqFt: number | null
      nup: number | null
      costPerMSF: number | null
      source: string
    }
    const boardCostBySpec = new Map<string, BoardCostInfo>()
    let boardInfoBySpec: Map<string, { boardArea: number; nup: number; stdCostPerMSF: number; step1Machine: number }> | null = null
    if (specSet.size > 0) {
      try {
        const specList = [...specSet].map(s => `'${s.replace(/'/g, "''")}'`).join(',')
        // Fetch route/board info for all specs
        const boardRes = await client.rawQuery<Record<string, unknown>>(
          `SELECT pd.designnumber,
                  r.boardarea,
                  ISNULL(r.lengthwisenoup, 1) * ISNULL(r.widthwisenoup, 1) as nup,
                  sb.costperarea as stdCostPerMSF,
                  ms1.machineno as step1Machine
           FROM dbo.ebxProductDesign pd
           OUTER APPLY (
             SELECT TOP 1 r2.ID, r2.boardarea, r2.lengthwisenoup, r2.widthwisenoup
             FROM dbo.ebxRoute r2
             WHERE r2.productDesignID = pd.ID AND r2.isDefault = -1
           ) r
           OUTER APPLY (
             SELECT TOP 1 ms2.machineno
             FROM dbo.ebxMachineStep ms2
             WHERE ms2.routeID = r.ID AND ms2.sequencenumber = 1
           ) ms1
           LEFT JOIN dbo.ebxStandardBoard sb ON pd.salesboardID = sb.ID
           WHERE pd.designnumber IN (${specList})`,
          {},
          'esp'
        )
        // Fetch ALL purchase cost quantity breaks for these specs (board-related only)
        const pcRes = await client.rawQuery<Record<string, unknown>>(
          `SELECT pd.designnumber, pc.uOM, pcqr.purchasecostperuom as costPerUom, pcqr.minimumquantity as minQty
           FROM dbo.ebxProductDesign pd
           JOIN dbo.cstPurchaseCost pc ON pc.productDesignID = pd.ID
           JOIN dbo.cstPurchaseCostDateRange pcdr ON pcdr.purchasecostID = pc.ID
           JOIN dbo.cstPurchaseCostQuantityRange pcqr ON pcqr.purchasecostdaterangeID = pcdr.ID
           WHERE pd.designnumber IN (${specList})
             AND pc.includeincosting = -1
             AND pc.uOM IN ('msf', '1000')
             AND pc.description IN ('Purchased Sheets', 'Purchased Finished Goods')
           ORDER BY pd.designnumber, CASE WHEN LOWER(pc.uOM) = 'msf' THEN 0 ELSE 1 END, pcdr.activedate DESC, pcqr.minimumquantity DESC`,
          {},
          'esp'
        )
        // Build price breaks map: spec -> array of { uom, costPerUom, minQty }
        const priceBreaksBySpec = new Map<string, { uom: string; costPerUom: number; minQty: number }[]>()
        for (const r of pcRes.data ?? []) {
          const spec = String(r.designnumber ?? '')
          const entry = { uom: String(r.uOM ?? '').toLowerCase(), costPerUom: toNumber(r.costPerUom), minQty: toNumber(r.minQty) }
          if (!priceBreaksBySpec.has(spec)) priceBreaksBySpec.set(spec, [])
          priceBreaksBySpec.get(spec)!.push(entry)
        }
        // Build board info map (route + std price)
        boardInfoBySpec = new Map<string, { boardArea: number; nup: number; stdCostPerMSF: number; step1Machine: number }>()
        for (const row of boardRes.data ?? []) {
          const spec = String(row.designnumber ?? '')
          boardInfoBySpec.set(spec, {
            boardArea: toNumber(row.boardarea),
            nup: toNumber(row.nup) || 1,
            stdCostPerMSF: toNumber(row.stdCostPerMSF),
            step1Machine: toNumber(row.step1Machine),
          })
        }
        // Helper: pick best price break for a given quantity
        const pickBestPrice = (breaks: { uom: string; costPerUom: number; minQty: number }[], qty: number, nup: number) => {
          // Prefer MSF pricing first
          const msfBreaks = breaks.filter(b => b.uom === 'msf')
          const msfMatch = msfBreaks.find(b => b.minQty <= qty) ?? msfBreaks[msfBreaks.length - 1]
          if (msfMatch && msfMatch.costPerUom > 0) return msfMatch
          // Then per-1000: minQty is in sheets, convert piece qty to sheets
          const sheetQty = nup > 0 ? Math.ceil(qty / nup) : qty
          const perMBreaks = breaks.filter(b => b.uom === '1000')
          const perMMatch = perMBreaks.find(b => b.minQty <= sheetQty) ?? perMBreaks[perMBreaks.length - 1]
          if (perMMatch && perMMatch.costPerUom > 0) return perMMatch
          return null
        }
        // Now enrich each row individually with quantity-aware pricing
        for (const row of rows) {
          const spec = row.specNumber
          const info = boardInfoBySpec.get(spec)
          if (!info) continue
          // Only calculate Jet Board for 1100 (Board Supply) MFG jobs
          // Skip 1500 (Customer Supplied Board), 1200 (Purchased Goods), etc.
          if (info.step1Machine !== 1100) continue
          const { boardArea, nup, stdCostPerMSF } = info
          const breaks = priceBreaksBySpec.get(spec)
          const best = breaks ? pickBestPrice(breaks, row.quantity, nup) : null
          if (best && best.uom === 'msf' && boardArea > 0) {
            boardCostBySpec.set(`${spec}|${row.quantity}`, {
              costPerM: (boardArea / nup) * best.costPerUom,
              boardAreaSqFt: boardArea, nup, costPerMSF: best.costPerUom, source: 'supplier'
            })
          } else if (best && best.uom === '1000') {
            // UOM "1000" = price per 1,000 sheets; divide by N-up to get per 1,000 pieces
            const costPerMPieces = nup > 0 ? best.costPerUom / nup : best.costPerUom
            boardCostBySpec.set(`${spec}|${row.quantity}`, {
              costPerM: costPerMPieces,
              boardAreaSqFt: boardArea > 0 ? boardArea : null, nup: boardArea > 0 ? nup : null,
              costPerMSF: boardArea > 0 && nup > 0 ? (costPerMPieces / (boardArea / nup)) : null, source: 'supplier/M'
            })
          } else if (stdCostPerMSF > 0 && boardArea > 0) {
            boardCostBySpec.set(`${spec}|${row.quantity}`, {
              costPerM: (boardArea / nup) * stdCostPerMSF,
              boardAreaSqFt: boardArea, nup, costPerMSF: stdCostPerMSF, source: 'standard'
            })
          }
        }
      } catch {
        // Board cost enrichment is optional — don't break the response
      }
    }

    // -----------------------------------------------------------------------
    // Batch enrichment: board-only est/act costs from cost estimate lines
    // Board rules: costobject=1 (board/sheet) + rules 1,2 (purchased sheets area/qty)
    // Excludes: pallets(20), strapping(6), wrap(64), ink(21), tapes, glue, etc.
    // -----------------------------------------------------------------------
    const jobSet = new Set(rows.map(r => r.jobNumber).filter(Boolean))
    if (jobSet.size > 0) {
      try {
        const jobList = [...jobSet].map(j => `'${j.replace(/'/g, "''")}'`).join(',')
        // totalcost in cstCostEstimateLine is per-M (per 1000 of calculationquantity)
        // Return per-M sums; convert to total dollars in JS using each row's qty
        const boardCostRes = await client.rawQuery<Record<string, unknown>>(
          `SELECT
             o.jobnumber,
             SUM(CASE WHEN cel.costEstimateID = o.precostestimateID THEN cel.totalcost ELSE 0 END) as preBoardPerM,
             SUM(CASE WHEN cel.costEstimateID = pco.costEstimateID THEN cel.totalcost ELSE 0 END) as postBoardPerM
           FROM dbo.espOrder o
           LEFT JOIN dbo.ocsPostcostedorder pco ON pco.orderID = o.ID
           JOIN dbo.cstCostEstimateLine cel ON cel.costEstimateID IN (o.precostestimateID, pco.costEstimateID)
           JOIN dbo.cstCostRule cr ON cel.costRuleID = cr.ID
           WHERE o.jobnumber IN (${jobList})
             AND cel.costinggroup = 0
             AND (cr.costobject = 1 OR cr.ID IN (1, 2))
           GROUP BY o.jobnumber`,
          {},
          'esp'
        )
        const boardPerMByJob = new Map<string, { estPerM: number; actPerM: number }>()
        for (const r of boardCostRes.data ?? []) {
          boardPerMByJob.set(String(r.jobnumber ?? ''), {
            estPerM: toNumber(r.preBoardPerM),
            actPerM: toNumber(r.postBoardPerM),
          })
        }
        // Convert per-M rates to total dollars using each row's quantity
        for (const row of rows) {
          const bc = boardPerMByJob.get(row.jobNumber)
          if (bc) {
            row.estBoardCost = bc.estPerM * row.quantity / 1000
            row.actBoardCost = bc.actPerM * row.quantity / 1000
          }
        }
      } catch {
        // Board cost line enrichment is optional
      }
    }

    // Step 1 machine label lookup
    const step1Labels: Record<number, string> = {
      1100: 'Board Supply',
      1500: 'Customer Supplied',
      1200: 'Purchased Goods',
    }

    // Enrich rows with board cost (keyed by spec|quantity for qty-aware pricing)
    // and step 1 machine info
    for (const row of rows) {
      // Set step1Machine from board info lookup
      const info = boardInfoBySpec?.get(row.specNumber)
      if (info) {
        row.step1Machine = step1Labels[info.step1Machine] ?? (info.step1Machine ? `Machine ${info.step1Machine}` : null)
      }
      const bc = boardCostBySpec.get(`${row.specNumber}|${row.quantity}`)
      if (bc) {
        // Only show Jet Board if Kiwi's estimate also has board cost rules
        // If estBoardCost is 0/null, it's likely a farm-through (Rule 156 only) or missing estimate
        if (row.estBoardCost !== null && row.estBoardCost > 0) {
          row.jetBoardCostPerM = bc.costPerM
          row.jetBoardAreaSqFt = bc.boardAreaSqFt
          row.jetBoardNup = bc.nup
          row.jetCostPerMSF = bc.costPerMSF
          row.jetCostSource = bc.source
        }
      }
    }

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
        case 'jetBoardCost': return r.jetBoardCostPerM !== null ? (r.quantity * r.jetBoardCostPerM / 1000) : 0
        case 'jetVsEst': {
          if (r.jetBoardCostPerM === null) return 0
          const jetTotal = r.quantity * r.jetBoardCostPerM / 1000
          return jetTotal - (r.estBoardCost ?? r.estMaterialCost)
        }
        case 'jetVsAct': {
          if (r.jetBoardCostPerM === null) return 0
          const jetTotal = r.quantity * r.jetBoardCostPerM / 1000
          return jetTotal - (r.actBoardCost ?? r.actMaterialCost)
        }
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
      quantity: 0, estimatedHours: 0, jetBoardCost: 0, estBoardCost: 0, actBoardCost: 0,
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
      if (r.jetBoardCostPerM !== null && r.jetBoardCostPerM > 0) {
        totals.jetBoardCost += r.quantity * r.jetBoardCostPerM / 1000
      }
      if (r.estBoardCost !== null) totals.estBoardCost += r.estBoardCost
      if (r.actBoardCost !== null) totals.actBoardCost += r.actBoardCost
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

  const { customer, spec, salesRep, job, hasCustomer, hasSpec, hasSalesRep, hasJob } = parseDashboardFilters(c)

  try {
    const kv = c.env.AUTH_CACHE
    const key = cacheKey('invoice-cv:filter-options', {
      s: dates.startDate, e: dates.endDate,
      c: customer, sp: spec, sr: salesRep, j: job,
    })

    const result = await kvCache(kv, key, CacheTTL.FILTER_OPTIONS, async () => {
      const customerParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasSpec) customerParams.spec = spec
      if (hasSalesRep) customerParams.salesRep = salesRep
      if (hasJob) customerParams.job = job

      const salesRepParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasCustomer) salesRepParams.customer = customer
      if (hasSpec) salesRepParams.spec = spec
      if (hasJob) salesRepParams.job = job

      const specParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasCustomer) specParams.customer = customer
      if (hasSalesRep) specParams.salesRep = salesRep
      if (hasJob) specParams.job = job

      const jobParams: Record<string, unknown> = {
        startDate: dates.startDate,
        endDate: dates.endDate,
      }
      if (hasCustomer) jobParams.customer = customer
      if (hasSpec) jobParams.spec = spec
      if (hasSalesRep) jobParams.salesRep = salesRep

      const [customersRes, salesRepsRes, specsRes, jobsRes] = await Promise.all([
        client.rawQuery(getCustomerOptionsSQL(hasSpec, hasSalesRep, hasJob), customerParams, 'esp'),
        client.rawQuery(getSalesRepOptionsSQL(hasCustomer, hasSpec, hasJob), salesRepParams, 'esp'),
        client.rawQuery(getSpecOptionsSQL(hasCustomer, hasSalesRep, hasJob), specParams, 'esp'),
        client.rawQuery(getJobOptionsSQL(hasCustomer, hasSpec, hasSalesRep), jobParams, 'esp'),
      ])

      return {
        customers: ((customersRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.customerName ?? '')),
        salesReps: ((salesRepsRes.data as Array<Record<string, unknown>>) ?? []).map((r) => String(r.salesRep ?? '')),
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

// ---------------------------------------------------------------------------
// GET /api/erp/invoice-cost-variance/job-detail?job=C10394
// Full cost breakdown for a single job (shown when job filter is active)
// ---------------------------------------------------------------------------

invoiceCostVarianceDashboardRoutes.get('/job-detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const job = c.req.query('job')
  if (!job) {
    return c.json({ error: 'job is required' }, 400)
  }

  try {
    // Step 1: Get order info
    const orderRes = await client.rawQuery<Record<string, unknown>>(
      `SELECT TOP 1 ID, jobnumber, routeID, productdesignID, precostestimateID, orderedquantity, ordertype, stocklineID
       FROM dbo.espOrder WHERE jobnumber = @job`,
      { job },
      'esp'
    )
    const order = orderRes.data?.[0]
    if (!order) {
      return c.json({ error: 'Job not found' }, 404)
    }

    const orderId = order.ID
    const productDesignId = order.productdesignID
    const preCostId = order.precostestimateID
    const orderQty = toNumber(order.orderedquantity)

    // Step 1b: Get product design (spec number, description)
    const designRes = productDesignId
      ? await client.rawQuery<Record<string, unknown>>(
          `SELECT ID, designnumber, description, companyID, salesboardID, finishedarea, noperset, noofsets FROM dbo.ebxProductDesign WHERE ID = @id`,
          { id: productDesignId },
          'esp'
        )
      : { data: [] }
    const design = designRes.data?.[0]

    // Step 1c: Get customer name from company
    const custRes = design?.companyID
      ? await client.rawQuery<Record<string, unknown>>(
          `SELECT ID, name FROM dbo.orgCompany WHERE ID = @id`,
          { id: design.companyID },
          'esp'
        )
      : { data: [] }
    const customer = custRes.data?.[0]

    // Step 1d: Get board grade info
    const boardRes = design?.salesboardID
      ? await client.rawQuery<Record<string, unknown>>(
          `SELECT ID, name, costperarea FROM dbo.ebxStandardBoard WHERE ID = @id`,
          { id: design.salesboardID },
          'esp'
        )
      : { data: [] }
    const board = boardRes.data?.[0]

    // Step 2: Get post-cost estimate ID
    const postCostRes = await client.rawQuery<Record<string, unknown>>(
      `SELECT TOP 1 costEstimateID FROM dbo.ocsPostcostedorder WHERE orderID = @orderId ORDER BY ID DESC`,
      { orderId },
      'esp'
    )
    const postCostId = postCostRes.data?.[0]?.costEstimateID

    // Step 3: Get pre-cost and post-cost headers
    const estimateIds = [preCostId, postCostId].filter(Boolean)
    let preHeader: Record<string, unknown> | undefined
    let postHeader: Record<string, unknown> | undefined

    if (estimateIds.length > 0) {
      const idList = estimateIds.join(',')
      const headersRes = await client.rawQuery<Record<string, unknown>>(
        `SELECT ID, materialcost, labourcost, freightcost, fullcost, calculationquantity,
                CONVERT(VARCHAR(10), costingdate, 23) as costingdate, estimatetype
         FROM dbo.cstCostEstimate WHERE ID IN (${idList})`,
        {},
        'esp'
      )
      for (const h of headersRes.data ?? []) {
        if (Number(h.estimatetype) === 2 || h.ID === preCostId) preHeader = h
        if (Number(h.estimatetype) === 3 || h.ID === postCostId) postHeader = h
      }
    }

    // Step 4 & 5: Get cost estimate line items
    const getLines = async (estimateId: unknown) => {
      if (!estimateId) return []
      const res = await client.rawQuery<Record<string, unknown>>(
        `SELECT costinggroup, costRuleID, totalcost, rulequantity, costrate, calculationquantity, variableamount
         FROM dbo.cstcostEstimateLine WHERE costEstimateID = @id ORDER BY totalcost DESC`,
        { id: estimateId },
        'esp'
      )
      return res.data ?? []
    }
    const [preLines, postLines] = await Promise.all([getLines(preCostId), getLines(postCostId)])

    // Step 6: Get routes
    const routesRes = productDesignId
      ? await client.rawQuery<Record<string, unknown>>(
          `SELECT ID, name, routetype, routestatus, isDefault, minimumquantity,
                  boardarea, startlength, startwidth, widthwisenoup, lengthwisenoup,
                  salesarea
           FROM dbo.ebxRoute WHERE productDesignID = @id`,
          { id: productDesignId },
          'esp'
        )
      : { data: [] }

    // Step 7: Get invoices for this order
    const invoiceRes = await client.rawQuery<Record<string, unknown>>(
      `SELECT il.quantity, il.unitprice, il.goodsvalue, il.description,
              inv.invoicenumber, CONVERT(VARCHAR(10), inv.transactiondate, 23) as invoiceDate
       FROM dbo.espInvoiceLine il
       INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
       WHERE il.orderID = @orderId AND inv.invoicestatus = 'Final' AND il.invoiceLineType = 'Goods Invoice Line'`,
      { orderId },
      'esp'
    )

    // Step 8: Get supplier purchase costs for this product design
    const purchaseCostsRes = productDesignId
      ? await client.rawQuery<Record<string, unknown>>(
          `SELECT pc.description, pc.uOM, sc.name as supplierName,
                  CONVERT(VARCHAR(10), pcdr.activedate, 23) as activeDate,
                  CONVERT(VARCHAR(10), pcdr.validtodate, 23) as validToDate,
                  pcqr.minimumquantity, pcqr.purchasecostperuom
           FROM dbo.cstPurchaseCost pc
           JOIN dbo.cstPurchaseCostDateRange pcdr ON pcdr.purchasecostID = pc.ID
           JOIN dbo.cstPurchaseCostQuantityRange pcqr ON pcqr.purchasecostdaterangeID = pcdr.ID
           LEFT JOIN dbo.orgCompany sc ON pc.supplierCompanyID = sc.ID
           WHERE pc.productDesignID = @pdId AND pc.includeincosting = -1
           ORDER BY pcdr.activedate DESC, pcqr.minimumquantity`,
          { pdId: productDesignId },
          'esp'
        )
      : { data: [] }
    const purchaseCosts = (purchaseCostsRes.data ?? []).map((r) => ({
      description: String(r.description ?? ''),
      supplier: String(r.supplierName ?? 'Unknown'),
      uom: String(r.uOM ?? ''),
      activeDate: String(r.activeDate ?? ''),
      validToDate: r.validToDate ? String(r.validToDate) : null,
      minQty: toNumber(r.minimumquantity),
      costPerUom: toNumber(r.purchasecostperuom),
    }))

    // Cost estimate header values are already per-M (dollars per 1000 pieces)
    const preMat = preHeader ? toNumber(preHeader.materialcost) : 0
    const preLab = preHeader ? toNumber(preHeader.labourcost) : 0
    const preFrt = preHeader ? toNumber(preHeader.freightcost) : 0
    const postMat = postHeader ? toNumber(postHeader.materialcost) : 0
    const postLab = postHeader ? toNumber(postHeader.labourcost) : 0
    const postFrt = postHeader ? toNumber(postHeader.freightcost) : 0

    // Look up cost rule descriptions from ESP
    const allRuleIds = new Set<number>()
    for (const line of [...preLines, ...postLines]) {
      allRuleIds.add(toNumber(line.costRuleID))
    }
    const ruleDescriptions: Record<number, string> = {}
    if (allRuleIds.size > 0) {
      const ruleIdList = [...allRuleIds].join(',')
      const rulesRes = await client.rawQuery<Record<string, unknown>>(
        `SELECT ID, description FROM dbo.cstCostRule WHERE ID IN (${ruleIdList})`,
        {},
        'esp'
      )
      for (const r of rulesRes.data ?? []) {
        ruleDescriptions[toNumber(r.ID)] = String(r.description ?? '')
      }
    }

    type CostDriverCalcLine = {
      costRate: number
      variableAmount: number
      calcQty: number
      ruleQty: number
      totalCostPerM: number
    }
    type CostDriver = {
      costRuleID: number
      description: string
      preCostPerM: number
      postCostPerM: number
      preCalcLines: CostDriverCalcLine[]
      postCalcLines: CostDriverCalcLine[]
    }
    const driverMap = new Map<number, CostDriver>()
    const toCalcLine = (line: Record<string, unknown>): CostDriverCalcLine => ({
      costRate: toNumber(line.costrate),
      variableAmount: toNumber(line.variableamount),
      calcQty: toNumber(line.calculationquantity),
      ruleQty: toNumber(line.rulequantity),
      totalCostPerM: toNumber(line.totalcost),
    })

    // totalcost on line items is already per-M (dollars per 1000 pieces)
    for (const line of preLines) {
      const ruleId = toNumber(line.costRuleID)
      const costPerM = toNumber(line.totalcost)
      const existing = driverMap.get(ruleId) ?? {
        costRuleID: ruleId,
        description: ruleDescriptions[ruleId] || `Rule ${ruleId}`,
        preCostPerM: 0,
        postCostPerM: 0,
        preCalcLines: [],
        postCalcLines: [],
      }
      existing.preCostPerM += costPerM
      existing.preCalcLines.push(toCalcLine(line))
      driverMap.set(ruleId, existing)
    }
    for (const line of postLines) {
      const ruleId = toNumber(line.costRuleID)
      const costPerM = toNumber(line.totalcost)
      const existing = driverMap.get(ruleId) ?? {
        costRuleID: ruleId,
        description: ruleDescriptions[ruleId] || `Rule ${ruleId}`,
        preCostPerM: 0,
        postCostPerM: 0,
        preCalcLines: [],
        postCalcLines: [],
      }
      existing.postCostPerM += costPerM
      existing.postCalcLines.push(toCalcLine(line))
      driverMap.set(ruleId, existing)
    }
    const costDrivers = [...driverMap.values()]
      .sort((a, b) => Math.abs(b.postCostPerM - b.preCostPerM) - Math.abs(a.postCostPerM - a.preCostPerM))
      .slice(0, 10)

    // Invoice totals
    const invoices = (invoiceRes.data ?? []).map((inv) => ({
      invoiceNumber: String(inv.invoicenumber ?? ''),
      invoiceDate: String(inv.invoiceDate ?? ''),
      quantity: toNumber(inv.quantity),
      unitPrice: toNumber(inv.unitprice),
      goodsValue: toNumber(inv.goodsvalue),
    }))
    const totalInvoiceQty = invoices.reduce((s, i) => s + i.quantity, 0)
    const totalInvoiceValue = invoices.reduce((s, i) => s + i.goodsValue, 0)
    const avgPricePerM = totalInvoiceQty > 0 ? (totalInvoiceValue / totalInvoiceQty) * 1000 : 0
    const postFullCostPerM = postMat + postLab + postFrt
    const margin = avgPricePerM > 0 ? ((avgPricePerM - postFullCostPerM) / avgPricePerM) * 100 : 0

    // Board analysis: compare pre-cost (Rule 1/2/3 = purchased sheets) vs post-cost (Rule 122 = consumed board)
    // Rule 1 = Purchased Sheets - Area, Rule 2 = Purchased Sheets - Qty, Rule 3 = Purchased Sheets
    // Sum ALL matching lines — some jobs have multiple board lines per routing step
    const preBoardLines = preLines.filter((l) => [1, 2, 3].includes(toNumber(l.costRuleID)))
    const postBoardLines = postLines.filter((l) => toNumber(l.costRuleID) === 122)
    const boardGrade = board ? String(board.name ?? '') : ''
    const stdCostPerMSF = board ? toNumber(board.costperarea) : 0

    // Board area per M from product design (reliable, same for pre & post)
    const designAreaSqFtPerPiece = design ? toNumber(design.finishedarea) : 0
    const boardAreaPerM = designAreaSqFtPerPiece * 1000  // sqft per 1000 pieces

    const preBoardTotalCostPerM = preBoardLines.reduce((s, l) => s + toNumber(l.totalcost), 0)
    const postBoardTotalCostPerM = postBoardLines.reduce((s, l) => s + toNumber(l.totalcost), 0)

    // Build individual board line details for breakdown display
    const formatBoardLine = (l: Record<string, unknown>, type: 'pre' | 'post') => ({
      type,
      ruleId: toNumber(l.costRuleID),
      description: ruleDescriptions[toNumber(l.costRuleID)] || `Rule ${toNumber(l.costRuleID)}`,
      totalCostPerM: toNumber(l.totalcost),
      calcQty: toNumber(l.calculationquantity),
      costRate: toNumber(l.costrate),
      variableAmount: toNumber(l.variableamount),
    })
    const boardLines = [
      ...preBoardLines.map((l) => formatBoardLine(l, 'pre')),
      ...postBoardLines.map((l) => formatBoardLine(l, 'post')),
    ]

    const boardAnalysis = {
      boardGrade,
      stdCostPerMSF,
      boardAreaPerM,
      boardLines,
      preCost: {
        totalCostPerM: preBoardTotalCostPerM,
      },
      postCost: {
        totalCostPerM: postBoardTotalCostPerM,
      },
    }

    // Active route
    const activeRoute = (routesRes.data ?? []).find((r) => Number(r.isDefault) === -1) ?? (routesRes.data ?? [])[0]

    // -----------------------------------------------------------------------
    // Calloff Board Cost Analysis
    // -----------------------------------------------------------------------
    const orderType = toNumber(order.ordertype)
    const stocklineId = toNumber(order.stocklineID)
    let calloffAnalysis: Record<string, unknown> | null = null

    if (orderType === 1 && stocklineId > 0) {
      try {
        // Find manufacturing/replenishment jobs for the same stock line (ordertype 0=mfg, 2=stock replenishment)
        // Prioritize post-costed jobs (those with ocsPostcostedorder) so we get useful cost data
        const mfgOrdersRes = await client.rawQuery<Record<string, unknown>>(
          `SELECT TOP 5 o.jobnumber, o.ID as orderID, o.precostestimateID, o.ordertype
           FROM dbo.espOrder o
           LEFT JOIN dbo.ocsPostcostedorder pco ON pco.orderID = o.ID
           WHERE o.stocklineID = @stocklineId AND o.ordertype != 1
           ORDER BY CASE WHEN pco.costestimateID IS NOT NULL THEN 0 ELSE 1 END, o.ID DESC`,
          { stocklineId },
          'esp'
        )

        const mfgJobs: Array<{
          jobNumber: string
          boardCostPerM: number
          boardLines: Array<{
            ruleId: number
            description: string
            costRate: number
            variableAmount: number
            totalCostPerM: number
          }>
          numberUp: number | null
          sheetsIssued: number | null
          sheetsToDieCut: number | null
          blanksOut: number | null
          sheetWastePct: number | null
          dieCutMachine: string | null
          orderSheetsPerHr: number | null
          steps: Array<{
            step: number
            series: number
            machine: string
            machineNumber: string
            nupIn: number
            nupOut: number
            qtyFedIn: number
            qtyProduced: number
            sheetsFed: number
            sheetsProduced: number
            runMins: number
            sheetsPerHr: number | null
          }>
        }> = []

        for (const mfgOrder of mfgOrdersRes.data ?? []) {
          const mfgJobNumber = String(mfgOrder.jobnumber ?? '')
          const mfgOrderId = mfgOrder.orderID

          // Get post-cost estimate for this mfg job
          const mfgPostCostRes = await client.rawQuery<Record<string, unknown>>(
            `SELECT pco.costestimateID
             FROM dbo.ocsPostcostedorder pco
             WHERE pco.orderID = @orderId`,
            { orderId: mfgOrderId },
            'esp'
          )
          const mfgPostCostId = mfgPostCostRes.data?.[0]?.costestimateID

          let mfgBoardCostPerM = 0
          const mfgBoardLines: Array<{
            ruleId: number
            description: string
            costRate: number
            variableAmount: number
            totalCostPerM: number
          }> = []

          if (mfgPostCostId) {
            const mfgPostLinesRes = await client.rawQuery<Record<string, unknown>>(
              `SELECT cel.costRuleID, cel.totalcost, cel.costrate, cel.variableamount,
                      cr.description
               FROM dbo.cstCostEstimateLine cel
               LEFT JOIN dbo.cstCostRule cr ON cr.ID = cel.costRuleID
               WHERE cel.costEstimateID = @ceId AND cel.costRuleID = 122`,
              { ceId: mfgPostCostId },
              'esp'
            )
            for (const line of mfgPostLinesRes.data ?? []) {
              const tc = toNumber(line.totalcost)
              mfgBoardCostPerM += tc
              mfgBoardLines.push({
                ruleId: toNumber(line.costRuleID),
                description: String(line.description ?? 'Rule 122'),
                costRate: toNumber(line.costrate),
                variableAmount: toNumber(line.variableamount),
                totalCostPerM: tc,
              })
            }
          }

          // Get KDW production data: Board Supply + first converting step + last step
          let numberUp: number | null = null
          let sheetsIssued: number | null = null
          let sheetsToDieCut: number | null = null
          let blanksOut: number | null = null
          let sheetWastePct: number | null = null
          let dieCutMachine: string | null = null
          let orderSheetsPerHr: number | null = null
          const steps: Array<{
            step: number; series: number; machine: string; machineNumber: string; nupIn: number; nupOut: number
            qtyFedIn: number; qtyProduced: number; sheetsFed: number; sheetsProduced: number
            runMins: number; sheetsPerHr: number | null
          }> = []
          try {
            // First converting step: get number_up_entry/number_up_exit = number-out (blanks per sheet)
            // Also get sheets fed (normalized) + machine name
            const convertRes = await client.rawQuery<Record<string, unknown>>(
              `SELECT
                 SUM(pf.quantity_fed_in) as totalFedIn,
                 SUM(pf.run_duration_minutes) as totalRunMins,
                 MAX(jss.number_up_entry_1) as nupEntry1,
                 MAX(jss.number_up_entry_2) as nupEntry2,
                 MAX(jss.number_up_exit_1) as nupExit1,
                 MAX(jss.number_up_exit_2) as nupExit2,
                 MIN(cc.costcenter_name) as machineName
               FROM dwjobseriesstep jss
               JOIN dwproductionfeedback pf ON pf.feedback_job_series_step_id = jss.job_series_step_id
               JOIN dwcostcenters cc ON cc.costcenter_id = jss.jss_costcenter_id
               WHERE jss.feedback_job_number = @job
                 AND cc.convert_flag = 'true'
                 AND cc.board_supply_flag != 'true'
                 AND jss.job_step = (
                   SELECT MIN(j2.job_step) FROM dwjobseriesstep j2
                   JOIN dwcostcenters c2 ON c2.costcenter_id = j2.jss_costcenter_id
                   WHERE j2.feedback_job_number = @job AND c2.convert_flag = 'true' AND c2.board_supply_flag != 'true'
                 )`,
              { job: mfgJobNumber },
              'kdw'
            )
            const cv = convertRes.data?.[0]
            // number-out = entry / exit (e.g. entry=2, exit=1 → 2 blanks per sheet)
            const nupEntry = (toNumber(cv?.nupEntry1) || 1) * (toNumber(cv?.nupEntry2) || 1)
            const nupExit = (toNumber(cv?.nupExit1) || 1) * (toNumber(cv?.nupExit2) || 1)
            const numOut = nupEntry / nupExit
            numberUp = numOut > 0 ? numOut : 1

            if (cv) {
              dieCutMachine = cv.machineName ? String(cv.machineName) : null
              if (toNumber(cv.totalFedIn) > 0) {
                // Sheets to die cut = qty fed / entry nup (normalize to physical sheets)
                sheetsToDieCut = Math.round(toNumber(cv.totalFedIn) / nupEntry)
                const cvRunHrs = toNumber(cv.totalRunMins) / 60
                if (cvRunHrs > 0) {
                  orderSheetsPerHr = Math.round(sheetsToDieCut / cvRunHrs)
                }
              }
            }

            // Board Supply step: normalize to physical sheets using entry nup
            const boardSupplyRes = await client.rawQuery<Record<string, unknown>>(
              `SELECT
                 SUM(pf.quantity_fed_in) as totalFedIn,
                 MAX(jss.number_up_entry_1) as nupEntry1,
                 MAX(jss.number_up_entry_2) as nupEntry2
               FROM dwjobseriesstep jss
               JOIN dwproductionfeedback pf ON pf.feedback_job_series_step_id = jss.job_series_step_id
               JOIN dwcostcenters cc ON cc.costcenter_id = jss.jss_costcenter_id
               WHERE jss.feedback_job_number = @job AND cc.board_supply_flag = 'true'`,
              { job: mfgJobNumber },
              'kdw'
            )
            const bs = boardSupplyRes.data?.[0]
            if (bs && toNumber(bs.totalFedIn) > 0) {
              const bsNup = (toNumber(bs.nupEntry1) || 1) * (toNumber(bs.nupEntry2) || 1)
              sheetsIssued = Math.round(toNumber(bs.totalFedIn) / bsNup)
            }

            // Sheet waste = (sheets issued - sheets to die cut) / sheets issued
            if (sheetsIssued !== null && sheetsToDieCut !== null && sheetsIssued > 0) {
              sheetWastePct = ((sheetsIssued - sheetsToDieCut) / sheetsIssued) * 100
            }

            // Last step: final output normalized to physical sheets
            const lastStepRes = await client.rawQuery<Record<string, unknown>>(
              `SELECT SUM(pf.quantity_produced) as totalProduced,
                      MAX(jss.number_up_exit_1) as nupExit1,
                      MAX(jss.number_up_exit_2) as nupExit2
               FROM dwjobseriesstep jss
               JOIN dwproductionfeedback pf ON pf.feedback_job_series_step_id = jss.job_series_step_id
               WHERE jss.feedback_job_number = @job
                 AND jss.job_step = (SELECT MAX(j2.job_step) FROM dwjobseriesstep j2 WHERE j2.feedback_job_number = @job)`,
              { job: mfgJobNumber },
              'kdw'
            )
            const ls = lastStepRes.data?.[0]
            if (ls && toNumber(ls.totalProduced) > 0) {
              // Final output is in exit nup units — divide by numOut to get sheet-equivalents
              blanksOut = Math.round(toNumber(ls.totalProduced) / numberUp)
            }
            // All steps: aggregated per step with cost center name and nup
            const allStepsRes = await client.rawQuery<Record<string, unknown>>(
              `SELECT
                 jss.job_step,
                 jss.job_series,
                 MIN(cc.costcenter_name) as machineName,
                 MIN(cc.costcenter_number) as machineNumber,
                 MAX(jss.number_up_entry_1) as nupEntry1,
                 MAX(jss.number_up_entry_2) as nupEntry2,
                 MAX(jss.number_up_exit_1) as nupExit1,
                 MAX(jss.number_up_exit_2) as nupExit2,
                 SUM(pf.quantity_fed_in) as totalFedIn,
                 SUM(pf.quantity_produced) as totalProduced,
                 SUM(pf.run_duration_minutes) as totalRunMins
               FROM dwjobseriesstep jss
               JOIN dwproductionfeedback pf ON pf.feedback_job_series_step_id = jss.job_series_step_id
               JOIN dwcostcenters cc ON cc.costcenter_id = jss.jss_costcenter_id
               WHERE jss.feedback_job_number = @job
               GROUP BY jss.job_step, jss.job_series
               ORDER BY jss.job_step, jss.job_series`,
              { job: mfgJobNumber },
              'kdw'
            )
            for (const row of allStepsRes.data ?? []) {
              const sNupIn = (toNumber(row.nupEntry1) || 1) * (toNumber(row.nupEntry2) || 1)
              const sNupOut = (toNumber(row.nupExit1) || 1) * (toNumber(row.nupExit2) || 1)
              const fedIn = toNumber(row.totalFedIn)
              const produced = toNumber(row.totalProduced)
              const runMins = toNumber(row.totalRunMins)
              const runHrs = runMins / 60
              steps.push({
                step: toNumber(row.job_step),
                series: toNumber(row.job_series),
                machine: String(row.machineName ?? ''),
                machineNumber: String(row.machineNumber ?? ''),
                nupIn: sNupIn,
                nupOut: sNupOut,
                qtyFedIn: fedIn,
                qtyProduced: produced,
                sheetsFed: Math.round(fedIn / sNupIn),
                sheetsProduced: Math.round(produced / sNupOut),
                runMins,
                sheetsPerHr: runHrs > 0 ? Math.round((fedIn / sNupIn) / runHrs) : null,
              })
            }
          } catch {
            // KDW queries may fail for older jobs — not critical
          }

          if (mfgBoardCostPerM > 0 || sheetsIssued !== null) {
            mfgJobs.push({
              jobNumber: mfgJobNumber,
              boardCostPerM: mfgBoardCostPerM,
              boardLines: mfgBoardLines,
              numberUp,
              sheetsIssued,
              sheetsToDieCut,
              blanksOut,
              sheetWastePct,
              dieCutMachine,
              orderSheetsPerHr,
              steps,
            })
          }
        }

        // Compute average mfg board cost
        const mfgWithCost = mfgJobs.filter((j) => j.boardCostPerM > 0)
        const mfgAvgBoardCostPerM = mfgWithCost.length > 0
          ? mfgWithCost.reduce((s, j) => s + j.boardCostPerM, 0) / mfgWithCost.length
          : 0

        const calloffBoardCostPerM = postBoardTotalCostPerM
        const costRatio = mfgAvgBoardCostPerM > 0
          ? calloffBoardCostPerM / mfgAvgBoardCostPerM
          : null

        calloffAnalysis = {
          isCalloff: true,
          stocklineId,
          calloffBoardCostPerM,
          mfgAvgBoardCostPerM,
          costRatio,
          mfgJobs,
        }
      } catch {
        // Calloff analysis is supplementary — don't break the main response
        calloffAnalysis = null
      }
    }

    // -----------------------------------------------------------------------
    // Production Steps (for any job)
    // -----------------------------------------------------------------------
    let productionSteps: Array<{
      step: number; series: number; machine: string; machineNumber: string
      nupIn: number; nupOut: number; qtyFedIn: number; qtyProduced: number
      sheetsFed: number; sheetsProduced: number; runMins: number; sheetsPerHr: number | null
    }> = []
    try {
      const stepsRes = await client.rawQuery<Record<string, unknown>>(
        `SELECT
           jss.job_step, jss.job_series,
           MIN(cc.costcenter_name) as machineName,
           MIN(cc.costcenter_number) as machineNumber,
           MAX(jss.number_up_entry_1) as nupEntry1,
           MAX(jss.number_up_entry_2) as nupEntry2,
           MAX(jss.number_up_exit_1) as nupExit1,
           MAX(jss.number_up_exit_2) as nupExit2,
           SUM(pf.quantity_fed_in) as totalFedIn,
           SUM(pf.quantity_produced) as totalProduced,
           SUM(pf.run_duration_minutes) as totalRunMins
         FROM dwjobseriesstep jss
         JOIN dwproductionfeedback pf ON pf.feedback_job_series_step_id = jss.job_series_step_id
         JOIN dwcostcenters cc ON cc.costcenter_id = jss.jss_costcenter_id
         WHERE jss.feedback_job_number = @job
         GROUP BY jss.job_step, jss.job_series
         ORDER BY jss.job_step, jss.job_series`,
        { job: String(order.jobnumber ?? '') },
        'kdw'
      )
      for (const row of stepsRes.data ?? []) {
        const sNupIn = (toNumber(row.nupEntry1) || 1) * (toNumber(row.nupEntry2) || 1)
        const sNupOut = (toNumber(row.nupExit1) || 1) * (toNumber(row.nupExit2) || 1)
        const fedIn = toNumber(row.totalFedIn)
        const produced = toNumber(row.totalProduced)
        const runMins = toNumber(row.totalRunMins)
        const runHrs = runMins / 60
        productionSteps.push({
          step: toNumber(row.job_step),
          series: toNumber(row.job_series),
          machine: String(row.machineName ?? ''),
          machineNumber: String(row.machineNumber ?? ''),
          nupIn: sNupIn,
          nupOut: sNupOut,
          qtyFedIn: fedIn,
          qtyProduced: produced,
          sheetsFed: Math.round(fedIn / sNupIn),
          sheetsProduced: Math.round(produced / sNupOut),
          runMins,
          sheetsPerHr: runHrs > 0 ? Math.round((fedIn / sNupIn) / runHrs) : null,
        })
      }
    } catch {
      // KDW query may fail — not critical
    }

    // -----------------------------------------------------------------------
    // Jet Standard Board Cost — our own transparent board cost calculation
    // Uses: ebxRoute.boardarea (gross sheet sqft), actual sheets fed from KDW,
    // and supplier purchase cost $/MSF from cstPurchaseCost
    // -----------------------------------------------------------------------
    let jetBoardCost: {
      grossSheetAreaSqFt: number
      blankAreaSqFt: number
      nup: number
      shrinkagePct: number
      supplierCostPerMSF: number
      supplierName: string
      pricingBasis: string // 'msf' | '1000' | 'standard'
      rawSupplierCost: number // the actual supplier quote value
      totalSheetsFed: number
      totalMSFConsumed: number
      totalBoardCost: number
      boardCostPerM: number
      kiwiPostCostPerM: number
      deltaPct: number | null
    } | null = null

    try {
      const route = activeRoute
      const grossSheetArea = route ? toNumber(route.boardarea) : 0
      const routeNup = route ? (toNumber(route.lengthwisenoup) || 1) * (toNumber(route.widthwisenoup) || 1) : 1
      const blankArea = design ? toNumber(design.finishedarea) : 0
      const usableArea = blankArea * routeNup
      const shrinkagePct = grossSheetArea > 0 ? ((grossSheetArea - usableArea) / grossSheetArea) * 100 : 0

      // Only calculate Jet Board for 1100 (Board Supply) jobs
      // Skip 1500 (Customer Supplied Board), 1200 (Purchased Goods), etc.
      const step1MachineNum = productionSteps.length > 0 ? Number(productionSteps[0].machineNumber) : 0
      const isBoardSupplyJob = step1MachineNum === 1100

      // Pick the best supplier cost — 2-tier fallback:
      // 1. Supplier $/MSF × area
      // 2. Supplier per-1000 (direct board cost per M)
      const boardCostTypes = ['Purchased Sheets', 'Purchased Finished Goods']
      const boardPurchaseCosts = purchaseCosts.filter(
        (pc) => boardCostTypes.includes(pc.description)
      )
      // Pick the best quantity break for the actual order qty
      const matchQty = totalInvoiceQty || orderQty
      const pickBestBreak = (costs: typeof boardPurchaseCosts, uomFilter: (uom: string) => boolean) => {
        const candidates = costs.filter(pc => uomFilter(pc.uom))
        // Best = highest minQty that order qualifies for
        const qualifying = candidates.filter(pc => pc.minQty <= matchQty).sort((a, b) => b.minQty - a.minQty)
        return qualifying[0] ?? candidates.sort((a, b) => a.minQty - b.minQty)[0] ?? null
      }
      const msfPurchaseCost = pickBestBreak(boardPurchaseCosts, u => u.toLowerCase().includes('msf'))
      // For per-1000 UOM, minQty is in sheets — convert piece qty to sheet qty
      const sheetMatchQty = routeNup > 0 ? Math.ceil(matchQty / routeNup) : matchQty
      const per1000PurchaseCost = (() => {
        const candidates = boardPurchaseCosts.filter(pc => pc.uom === '1000')
        const qualifying = candidates.filter(pc => pc.minQty <= sheetMatchQty).sort((a, b) => b.minQty - a.minQty)
        return qualifying[0] ?? candidates.sort((a, b) => a.minQty - b.minQty)[0] ?? null
      })()

      let supplierCostPerMSF = msfPurchaseCost?.costPerUom ?? 0
      let supplierName = msfPurchaseCost?.supplier ?? ''
      let pricingBasis = supplierCostPerMSF > 0 ? 'msf' : ''
      let rawSupplierCost = supplierCostPerMSF

      let totalSheetsFed = 0
      let boardCostPerM = 0
      let totalMSFConsumed = 0
      let totalBoardCost = 0
      let piecesProduced = 0

      const hasMfgSteps = productionSteps.length > 0 && orderType !== 1
        && productionSteps.some(s => s.qtyFedIn > 0)

      if (isBoardSupplyJob) {
        if (supplierCostPerMSF > 0 && grossSheetArea > 0) {
          // Tier 1: supplier $/MSF × area
          if (hasMfgSteps) {
            totalSheetsFed = productionSteps[0].sheetsFed
            totalMSFConsumed = (totalSheetsFed * grossSheetArea) / 1000
            totalBoardCost = totalMSFConsumed * supplierCostPerMSF
            piecesProduced = productionSteps[productionSteps.length - 1].qtyProduced || totalInvoiceQty
            boardCostPerM = piecesProduced > 0 ? (totalBoardCost / piecesProduced) * 1000 : 0
          } else if (routeNup > 0) {
            boardCostPerM = (grossSheetArea / routeNup) * supplierCostPerMSF
            piecesProduced = totalInvoiceQty
            totalSheetsFed = Math.round(piecesProduced / routeNup)
            totalMSFConsumed = (totalSheetsFed * grossSheetArea) / 1000
            totalBoardCost = totalMSFConsumed * supplierCostPerMSF
          }
        } else if (per1000PurchaseCost && per1000PurchaseCost.costPerUom > 0) {
          // Tier 2: supplier per-1000 sheets — divide by N-up to get per 1,000 pieces
          boardCostPerM = routeNup > 0 ? per1000PurchaseCost.costPerUom / routeNup : per1000PurchaseCost.costPerUom
          supplierName = per1000PurchaseCost.supplier
          pricingBasis = '1000'
          rawSupplierCost = per1000PurchaseCost.costPerUom
          // Back-derive $/MSF from per-piece cost
          if (grossSheetArea > 0 && routeNup > 0) {
            supplierCostPerMSF = boardCostPerM / (grossSheetArea / routeNup)
          }
          piecesProduced = totalInvoiceQty
          if (grossSheetArea > 0 && routeNup > 0) {
            totalSheetsFed = Math.round(piecesProduced / routeNup)
            totalMSFConsumed = (totalSheetsFed * grossSheetArea) / 1000
          }
          totalBoardCost = boardCostPerM * piecesProduced / 1000
        } else if (boardAnalysis.stdCostPerMSF > 0 && grossSheetArea > 0 && routeNup > 0) {
          // Tier 3: standard board price × area (fallback for 1100 jobs without supplier pricing)
          supplierCostPerMSF = boardAnalysis.stdCostPerMSF
          supplierName = 'Standard'
          pricingBasis = 'standard'
          rawSupplierCost = boardAnalysis.stdCostPerMSF
          boardCostPerM = (grossSheetArea / routeNup) * supplierCostPerMSF
          piecesProduced = totalInvoiceQty
          totalSheetsFed = Math.round(piecesProduced / routeNup)
          totalMSFConsumed = (totalSheetsFed * grossSheetArea) / 1000
          totalBoardCost = totalMSFConsumed * supplierCostPerMSF
        }
      }

      if (boardCostPerM > 0) {
        const kiwiPostCostPerM = postBoardTotalCostPerM
        const deltaPct = kiwiPostCostPerM > 0
          ? ((boardCostPerM - kiwiPostCostPerM) / kiwiPostCostPerM) * 100
          : null

        jetBoardCost = {
          grossSheetAreaSqFt: grossSheetArea,
          blankAreaSqFt: blankArea,
          nup: routeNup,
          shrinkagePct: Math.round(shrinkagePct * 10) / 10,
          supplierCostPerMSF,
          supplierName,
          pricingBasis,
          rawSupplierCost,
          totalSheetsFed,
          totalMSFConsumed: Math.round(totalMSFConsumed * 100) / 100,
          totalBoardCost: Math.round(totalBoardCost * 100) / 100,
          boardCostPerM: Math.round(boardCostPerM * 100) / 100,
          kiwiPostCostPerM,
          deltaPct: deltaPct !== null ? Math.round(deltaPct * 10) / 10 : null,
        }
      }
    } catch {
      // Non-critical — don't break the main response
    }

    return c.json({
      data: {
        jobNumber: String(order.jobnumber ?? ''),
        specNumber: String(design?.designnumber ?? ''),
        description: String(design?.description ?? ''),
        customerName: String(customer?.name ?? 'Unknown'),
        orderQty,
        actualQty: totalInvoiceQty,
        route: activeRoute ? `${activeRoute.ID} (${activeRoute.name || 'Default'})` : '',
        preCostDate: String(preHeader?.costingdate ?? ''),
        postCostDate: String(postHeader?.costingdate ?? ''),
        costComparison: {
          materialPerM: { pre: preMat, post: postMat },
          labourPerM: { pre: preLab, post: postLab },
          freightPerM: { pre: preFrt, post: postFrt },
          fullCostPerM: { pre: preMat + preLab + preFrt, post: postFullCostPerM },
        },
        costDrivers,
        profitability: {
          avgPricePerM,
          postCostPerM: postFullCostPerM,
          margin,
          totalInvoiceQty,
          totalInvoiceValue,
        },
        invoices,
        hasDoubleCounting: driverMap.has(122) && driverMap.has(156),
        boardAnalysis,
        purchaseCosts,
        calloffAnalysis,
        productionSteps,
        jetBoardCost,
      },
    })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// ---------------------------------------------------------------------------
// Spec Analysis — last 12 months for a given spec
// ---------------------------------------------------------------------------

invoiceCostVarianceDashboardRoutes.get('/spec-analysis', async (c) => {
  const spec = c.req.query('spec')
  if (!spec) return c.json({ error: 'spec parameter required' }, 400)

  const client = getClient(c.env)
  if (!client) return c.json({ error: 'Kiwiplan not configured' }, 503)

  try {
    // Monthly summary for last 12 months
    const summaryRes = await client.rawQuery<Record<string, unknown>>(
      `SELECT
        FORMAT(inv.transactiondate, 'yyyy-MM') as period,
        SUM(TRY_CAST(il.quantity AS FLOAT)) as quantity,
        COUNT(DISTINCT o.jobnumber) as jobCount,
        SUM(CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(il.quantity AS FLOAT) * TRY_CAST(pce.materialcost AS FLOAT) / 1000.0 ELSE 0 END) as totalEstMaterial,
        SUM(CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(il.quantity AS FLOAT) * TRY_CAST(postce.materialcost AS FLOAT) / 1000.0 ELSE 0 END) as totalActMaterial,
        SUM(CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(il.quantity AS FLOAT) * TRY_CAST(pce.labourcost AS FLOAT) / 1000.0 ELSE 0 END) as totalEstLabor,
        SUM(CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(il.quantity AS FLOAT) * TRY_CAST(postce.labourcost AS FLOAT) / 1000.0 ELSE 0 END) as totalActLabor,
        SUM(CASE WHEN pce.ID IS NOT NULL THEN TRY_CAST(il.quantity AS FLOAT) * TRY_CAST(pce.freightcost AS FLOAT) / 1000.0 ELSE 0 END) as totalEstFreight,
        SUM(CASE WHEN postce.ID IS NOT NULL THEN TRY_CAST(il.quantity AS FLOAT) * TRY_CAST(postce.freightcost AS FLOAT) / 1000.0 ELSE 0 END) as totalActFreight,
        SUM(TRY_CAST(il.goodsvalue AS FLOAT)) as totalRevenue
      FROM dbo.espInvoiceLine il
      INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
      INNER JOIN dbo.espOrder o ON il.orderID = o.ID
      LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
      LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
      LEFT JOIN dbo.cstCostEstimate pce ON o.precostestimateID = pce.ID
      OUTER APPLY (
        SELECT TOP 1 pco2.costEstimateID
        FROM dbo.ocsPostcostedorder pco2
        WHERE pco2.orderID = o.ID
        ORDER BY pco2.ID DESC
      ) pco
      LEFT JOIN dbo.cstCostEstimate postce ON pco.costEstimateID = postce.ID
      WHERE inv.invoicestatus = 'Final'
        AND il.invoiceLineType = 'Goods Invoice Line'
        AND inv.transactiondate >= DATEADD(MONTH, -12, GETDATE())
        AND pd.designnumber = @spec
      GROUP BY FORMAT(inv.transactiondate, 'yyyy-MM')
      ORDER BY period`,
      { spec },
      'esp'
    )

    // Job-level detail for the spec (last 12 months)
    const jobsRes = await client.rawQuery<Record<string, unknown>>(
      `SELECT
        o.jobnumber as jobNumber,
        CONVERT(VARCHAR(10), MAX(inv.transactiondate), 23) as lastInvoiceDate,
        SUM(TRY_CAST(il.quantity AS FLOAT)) as quantity,
        CASE WHEN MAX(pce.ID) IS NOT NULL THEN MAX(TRY_CAST(pce.materialcost AS FLOAT)) ELSE NULL END as estMaterialPerM,
        CASE WHEN MAX(pce.ID) IS NOT NULL THEN MAX(TRY_CAST(pce.labourcost AS FLOAT)) ELSE NULL END as estLaborPerM,
        CASE WHEN MAX(postce.ID) IS NOT NULL THEN MAX(TRY_CAST(postce.materialcost AS FLOAT)) ELSE NULL END as actMaterialPerM,
        CASE WHEN MAX(postce.ID) IS NOT NULL THEN MAX(TRY_CAST(postce.labourcost AS FLOAT)) ELSE NULL END as actLaborPerM,
        CASE WHEN MAX(pce.ID) IS NOT NULL THEN MAX(TRY_CAST(pce.fullcost AS FLOAT)) ELSE NULL END as estFullCostPerM,
        CASE WHEN MAX(postce.ID) IS NOT NULL THEN MAX(TRY_CAST(postce.fullcost AS FLOAT)) ELSE NULL END as actFullCostPerM,
        SUM(TRY_CAST(il.goodsvalue AS FLOAT)) as revenue
      FROM dbo.espInvoiceLine il
      INNER JOIN dbo.espInvoice inv ON il.invoiceID = inv.ID
      INNER JOIN dbo.espOrder o ON il.orderID = o.ID
      LEFT JOIN dbo.ebxProductPrice pp ON o.productpriceID = pp.ID
      LEFT JOIN dbo.ebxProductDesign pd ON COALESCE(pp.productDesignID, o.productDesignID) = pd.ID
      LEFT JOIN dbo.cstCostEstimate pce ON o.precostestimateID = pce.ID
      OUTER APPLY (
        SELECT TOP 1 pco2.costEstimateID
        FROM dbo.ocsPostcostedorder pco2
        WHERE pco2.orderID = o.ID
        ORDER BY pco2.ID DESC
      ) pco
      LEFT JOIN dbo.cstCostEstimate postce ON pco.costEstimateID = postce.ID
      WHERE inv.invoicestatus = 'Final'
        AND il.invoiceLineType = 'Goods Invoice Line'
        AND inv.transactiondate >= DATEADD(MONTH, -12, GETDATE())
        AND pd.designnumber = @spec
      GROUP BY o.jobnumber
      ORDER BY lastInvoiceDate DESC`,
      { spec },
      'esp'
    )

    // Compute totals
    const months = (summaryRes.data ?? []).map((r) => ({
      period: String(r.period ?? ''),
      quantity: toNumber(r.quantity),
      jobCount: toNumber(r.jobCount),
      totalEstMaterial: toNumber(r.totalEstMaterial),
      totalActMaterial: toNumber(r.totalActMaterial),
      totalEstLabor: toNumber(r.totalEstLabor),
      totalActLabor: toNumber(r.totalActLabor),
      totalEstFreight: toNumber(r.totalEstFreight),
      totalActFreight: toNumber(r.totalActFreight),
      totalRevenue: toNumber(r.totalRevenue),
    }))

    const totalQty = months.reduce((s, m) => s + m.quantity, 0)
    const totalEstMat = months.reduce((s, m) => s + m.totalEstMaterial, 0)
    const totalActMat = months.reduce((s, m) => s + m.totalActMaterial, 0)
    const totalEstLab = months.reduce((s, m) => s + m.totalEstLabor, 0)
    const totalActLab = months.reduce((s, m) => s + m.totalActLabor, 0)
    const totalEstFrt = months.reduce((s, m) => s + m.totalEstFreight, 0)
    const totalActFrt = months.reduce((s, m) => s + m.totalActFreight, 0)
    const totalRevenue = months.reduce((s, m) => s + m.totalRevenue, 0)
    const perM = (total: number) => totalQty > 0 ? (total / totalQty) * 1000 : 0

    const jobs = (jobsRes.data ?? []).map((r) => ({
      jobNumber: String(r.jobNumber ?? ''),
      lastInvoiceDate: String(r.lastInvoiceDate ?? ''),
      quantity: toNumber(r.quantity),
      estFullCostPerM: toNumber(r.estFullCostPerM),
      actFullCostPerM: toNumber(r.actFullCostPerM),
      estMaterialPerM: toNumber(r.estMaterialPerM),
      actMaterialPerM: toNumber(r.actMaterialPerM),
      estLaborPerM: toNumber(r.estLaborPerM),
      actLaborPerM: toNumber(r.actLaborPerM),
      revenue: toNumber(r.revenue),
    }))

    return c.json({
      data: {
        spec,
        totalQty,
        totalJobs: jobs.length,
        totalRevenue,
        costComparison: {
          estMaterialPerM: perM(totalEstMat),
          actMaterialPerM: perM(totalActMat),
          estLaborPerM: perM(totalEstLab),
          actLaborPerM: perM(totalActLab),
          estFreightPerM: perM(totalEstFrt),
          actFreightPerM: perM(totalActFrt),
          estFullCostPerM: perM(totalEstMat + totalEstLab + totalEstFrt),
          actFullCostPerM: perM(totalActMat + totalActLab + totalActFrt),
          avgPricePerM: perM(totalRevenue),
        },
        months: months.map((m) => ({
          period: m.period,
          quantity: m.quantity,
          jobCount: m.jobCount,
          estFullCostPerM: m.quantity > 0 ? ((m.totalEstMaterial + m.totalEstLabor + m.totalEstFreight) / m.quantity) * 1000 : 0,
          actFullCostPerM: m.quantity > 0 ? ((m.totalActMaterial + m.totalActLabor + m.totalActFreight) / m.quantity) * 1000 : 0,
          avgPricePerM: m.quantity > 0 ? (m.totalRevenue / m.quantity) * 1000 : 0,
        })),
        jobs,
      },
    })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})
