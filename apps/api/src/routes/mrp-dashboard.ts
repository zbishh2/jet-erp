import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { logAudit } from '../services/audit'
import { kvCache, CacheTTL } from '../services/kv-cache'

export const mrpDashboardRoutes = new Hono<{ Bindings: Env }>()

function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

// ── Types ──────────────────────────────────────────────────────

type Granularity = 'day' | 'week' | '2week' | 'month'
type HealthState = 'good' | 'adequate' | 'belowMin' | 'shortage'

interface BucketDef {
  label: string
  startDate: Date
  endDate: Date
}

interface SpecBucket {
  projected: number
  demand: number
  supply: number
  health: HealthState
}

interface SpecRow {
  specNumber: string
  companyName: string
  customerSpec: string
  salesRep: string
  onHand: number
  minQty: number
  maxQty: number
  unitCost: number
  unitPrice: number
  last30DayUsage: number
  avg30DayUsage90: number
  minMonthsOfSupply: number | null
  maxMonthsOfSupply: number | null
  onHandMonthsOfSupply: number | null
  hasOrders: boolean
  hasMinOrMax: boolean
  shortageDate: string | null
  belowMinDate: string | null
  hasPastDues: boolean
  buckets: SpecBucket[]
}

// ── SQL Queries ────────────────────────────────────────────────

const MRP_SQL = {
  inventory: `
    SELECT
      pd.designnumber AS specNumber,
      co.name AS companyName,
      ISNULL(pd.customerSpec, '') AS customerSpec,
      ISNULL(con.firstname + ' ' + con.lastname, '') AS salesRep,
      SUM(ISNULL(sl.totalphysical, 0)) AS onHand,
      SUM(ISNULL(sl.minimumlevel, 0)) AS minQty,
      SUM(ISNULL(sl.maximumlevel, 0)) AS maxQty
    FROM fgsStockLine sl
    INNER JOIN ebxProductDesign pd ON sl.productdesignID = pd.ID
    INNER JOIN orgCompany co ON pd.companyID = co.ID
    LEFT JOIN orgContact con ON co.salesContactID = con.ID
    WHERE sl.storedescription IN ('Jet Container', 'Plant Store')
      AND sl.totalphysical IS NOT NULL
    GROUP BY pd.designnumber, co.name, pd.customerSpec, con.firstname, con.lastname
    ORDER BY pd.designnumber
  `,

  orders: `
    SELECT
      o.jobnumber AS jobNum,
      o.designnumber AS specNumber,
      (ISNULL(o.orderedquantity, 0) - ISNULL(o.shippedquantity, 0) - ISNULL(o.scrappedquantity, 0) + ISNULL(o.returnedquantity, 0)) AS remainingQty,
      CONVERT(VARCHAR(10), ISNULL(o.duedate, o.originalduedate), 23) AS dueDate,
      o.jobnumber AS jobNumber
    FROM espOrder o
    WHERE o.cancelleddate IS NULL
      AND o.orderstatus IN ('Part shipped', 'Work In Progress')
      AND (ISNULL(o.orderedquantity, 0) - ISNULL(o.shippedquantity, 0) - ISNULL(o.scrappedquantity, 0) + ISNULL(o.returnedquantity, 0)) > 0
    ORDER BY o.duedate
  `,

  prices: `
    SELECT
      pd.designnumber AS specNumber,
      pp.fullcost AS unitCost,
      pp.actualprice AS unitPrice
    FROM ebxProductPrice pp
    INNER JOIN ebxProductDesign pd ON pp.productDesignID = pd.ID
    WHERE pp.expiryDate IS NULL
  `,

  usage: `
    SELECT
      o.designnumber AS specNumber,
      SUM(CASE WHEN d.despatchdate >= DATEADD(DAY, -30, GETDATE()) THEN di.quantity ELSE 0 END) AS last30d,
      SUM(CASE WHEN d.despatchdate >= DATEADD(DAY, -90, GETDATE()) THEN di.quantity ELSE 0 END) / 3.0 AS avg30d90
    FROM espDocketItem di
    INNER JOIN espDocket d ON di.docketID = d.ID
    INNER JOIN espOrder o ON di.orderID = o.ID
    WHERE d.despatchdate >= DATEADD(DAY, -90, GETDATE())
    GROUP BY o.designnumber
  `,

  companies: `
    SELECT DISTINCT co.name AS companyName
    FROM fgsStockLine sl
    INNER JOIN ebxProductDesign pd ON sl.productdesignID = pd.ID
    INNER JOIN orgCompany co ON pd.companyID = co.ID
    WHERE sl.storedescription IN ('Jet Container', 'Plant Store')
      AND sl.totalphysical IS NOT NULL
    ORDER BY co.name
  `,

  specs: `
    SELECT DISTINCT pd.designnumber AS specNumber
    FROM fgsStockLine sl
    INNER JOIN ebxProductDesign pd ON sl.productdesignID = pd.ID
    WHERE sl.storedescription IN ('Jet Container', 'Plant Store')
      AND sl.totalphysical IS NOT NULL
    ORDER BY pd.designnumber
  `,

  specDetail_orders: `
    SELECT
      o.jobnumber AS jobNum,
      (ISNULL(o.orderedquantity, 0) - ISNULL(o.shippedquantity, 0) - ISNULL(o.scrappedquantity, 0) + ISNULL(o.returnedquantity, 0)) AS remainingQty,
      CONVERT(VARCHAR(10), ISNULL(o.duedate, o.originalduedate), 23) AS dueDate,
      CASE WHEN LEFT(o.jobnumber, 1) = 'C' THEN 'Demand' ELSE 'MO' END AS mrpType,
      co.name AS companyName,
      o.orderstatus AS orderStatus
    FROM espOrder o
    LEFT JOIN orgCompany co ON o.companyID = co.ID
    WHERE o.designnumber = @spec
      AND o.cancelleddate IS NULL
      AND o.orderstatus IN ('Part shipped', 'Work In Progress')
      AND (ISNULL(o.orderedquantity, 0) - ISNULL(o.shippedquantity, 0) - ISNULL(o.scrappedquantity, 0) + ISNULL(o.returnedquantity, 0)) > 0
    ORDER BY o.duedate
  `,

  specDetail_shipLog: `
    SELECT TOP 50
      o.designnumber AS specNumber,
      CONVERT(VARCHAR(10), d.despatchdate, 23) AS shipDate,
      di.quantity AS qty,
      co.name AS companyName,
      d.docketnumber AS docketNumber
    FROM espDocketItem di
    INNER JOIN espDocket d ON di.docketID = d.ID
    INNER JOIN espOrder o ON di.orderID = o.ID
    LEFT JOIN orgCompany co ON o.companyID = co.ID
    WHERE o.designnumber = @spec
    ORDER BY d.despatchdate DESC
  `,
}

// ── Bucket builder ─────────────────────────────────────────────

function buildBuckets(granularity: Granularity, horizon: number): BucketDef[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const buckets: BucketDef[] = []

  function addDays(d: Date, n: number): Date {
    const r = new Date(d)
    r.setDate(r.getDate() + n)
    return r
  }

  // Snap to Monday for week-based granularity
  function getMonday(d: Date): Date {
    const r = new Date(d)
    const day = r.getDay()
    const diff = day === 0 ? -6 : 1 - day
    r.setDate(r.getDate() + diff)
    return r
  }

  // Snap to 1st of month
  function getMonthStart(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }

  let stepDays: number
  let labelPrefix: string
  let anchor: Date

  switch (granularity) {
    case 'day':
      stepDays = 1
      labelPrefix = 'D'
      anchor = today
      break
    case 'week':
      stepDays = 7
      labelPrefix = 'W'
      anchor = getMonday(today)
      break
    case '2week':
      stepDays = 14
      labelPrefix = '2W'
      anchor = getMonday(today)
      break
    case 'month':
      // Month handled specially below
      stepDays = 0
      labelPrefix = 'M'
      anchor = getMonthStart(today)
      break
  }

  if (granularity === 'month') {
    // Past buckets
    for (let i = -horizon; i < 0; i++) {
      const start = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1)
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + i + 1, 1)
      buckets.push({ label: `${i}M`, startDate: start, endDate: end })
    }
    // Current bucket
    const curEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)
    buckets.push({ label: '0', startDate: anchor, endDate: curEnd })
    // Future buckets
    for (let i = 1; i <= horizon; i++) {
      const start = new Date(anchor.getFullYear(), anchor.getMonth() + i, 1)
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + i + 1, 1)
      buckets.push({ label: `+${i}M`, startDate: start, endDate: end })
    }
  } else {
    // Past buckets
    for (let i = -horizon; i < 0; i++) {
      const start = addDays(anchor, i * stepDays)
      const end = addDays(start, stepDays)
      buckets.push({ label: `${i}${labelPrefix}`, startDate: start, endDate: end })
    }
    // Current bucket
    const curEnd = addDays(anchor, stepDays)
    buckets.push({ label: '0', startDate: anchor, endDate: curEnd })
    // Future buckets
    for (let i = 1; i <= horizon; i++) {
      const start = addDays(anchor, i * stepDays)
      const end = addDays(start, stepDays)
      buckets.push({ label: `+${i}${labelPrefix}`, startDate: start, endDate: end })
    }
  }

  return buckets
}

function classifyHealth(projected: number, minQty: number, _maxQty: number): HealthState {
  if (projected <= 0) return 'shortage'
  if (projected < minQty) return 'belowMin'
  return 'good'
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Projection engine ──────────────────────────────────────────

function computeProjection(
  inventoryRows: Array<Record<string, unknown>>,
  orderRows: Array<Record<string, unknown>>,
  priceMap: Map<string, { unitCost: number; unitPrice: number }>,
  usageMap: Map<string, { last30d: number; avg30d90: number }>,
  buckets: BucketDef[],
  companyFilter: string | undefined,
  specFilter: string | undefined,
  activeFilters: string[],
  hasOrdersFilter: string | undefined,
  hasMinOrMaxFilter: string | undefined
) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Build order lookup by spec
  const ordersBySpec = new Map<string, Array<{ remainingQty: number; dueDate: string; isDemand: boolean }>>()
  for (const row of orderRows) {
    const spec = String(row.specNumber || '')
    const jobNum = String(row.jobNum || row.jobNumber || '')
    const isDemand = jobNum.startsWith('C')
    if (!ordersBySpec.has(spec)) ordersBySpec.set(spec, [])
    ordersBySpec.get(spec)!.push({
      remainingQty: Number(row.remainingQty) || 0,
      dueDate: String(row.dueDate || ''),
      isDemand,
    })
  }

  const specs: SpecRow[] = []
  let inShortage = 0
  let belowMin = 0
  let onHandCost = 0
  let onHandPrice = 0
  let pastDueCount = 0

  for (const inv of inventoryRows) {
    const specNumber = String(inv.specNumber || '')
    const companyName = String(inv.companyName || '')
    const customerSpec = String(inv.customerSpec || '')
    const salesRep = String(inv.salesRep || '')
    const onHand = Number(inv.onHand) || 0
    const minQty = Number(inv.minQty) || 0
    const maxQty = Number(inv.maxQty) || 0

    // Company filter
    if (companyFilter && companyFilter !== 'all' && companyName !== companyFilter) continue
    // Spec search filter
    if (specFilter && !specNumber.toLowerCase().includes(specFilter.toLowerCase()) && !customerSpec.toLowerCase().includes(specFilter.toLowerCase())) continue

    const prices = priceMap.get(specNumber) || { unitCost: 0, unitPrice: 0 }
    const usage = usageMap.get(specNumber) || { last30d: 0, avg30d90: 0 }
    const orders = ordersBySpec.get(specNumber) || []

    // Check past dues
    const hasPastDues = orders.some(o => {
      const due = new Date(o.dueDate)
      return due < today && o.isDemand
    })
    if (hasPastDues) pastDueCount++

    // Compute buckets
    const specBuckets: SpecBucket[] = []
    let runningBalance = onHand
    let shortageDate: string | null = null
    let belowMinDate: string | null = null
    let hasShortage = false
    let hasBelowMin = false

    for (const bucket of buckets) {
      let demand = 0
      let supply = 0

      for (const order of orders) {
        const due = new Date(order.dueDate)
        if (due >= bucket.startDate && due < bucket.endDate) {
          if (order.isDemand) {
            demand += order.remainingQty
          } else {
            supply += order.remainingQty
          }
        }
      }

      runningBalance = runningBalance - demand + supply
      const health = classifyHealth(runningBalance, minQty, maxQty)

      if (health === 'shortage' && !shortageDate) {
        shortageDate = toISODate(bucket.startDate)
        hasShortage = true
      }
      if ((health === 'belowMin' || health === 'shortage') && !belowMinDate) {
        belowMinDate = toISODate(bucket.startDate)
        hasBelowMin = true
      }

      specBuckets.push({ projected: runningBalance, demand, supply, health })
    }

    // Compute Months of Supply
    const avg30d = usage.avg30d90
    const minMonthsOfSupply = avg30d > 0 ? minQty / avg30d : null
    const maxMonthsOfSupply = avg30d > 0 ? maxQty / avg30d : null
    const onHandMonthsOfSupply = avg30d > 0 ? onHand / avg30d : null

    // Compute flags
    const hasOrdersFlag = orders.length > 0
    const hasMinOrMaxFlag = minQty > 0 || maxQty > 0

    // Apply active filters
    if (activeFilters.includes('shortage') && !hasShortage) continue
    if (activeFilters.includes('belowMin') && !hasBelowMin) continue
    if (activeFilters.includes('hasOrders') && orders.length === 0) continue
    if (activeFilters.includes('pastDue') && !hasPastDues) continue

    // Apply hasOrders / hasMinOrMax query param filters
    if (hasOrdersFilter === 'true' && !hasOrdersFlag) continue
    if (hasOrdersFilter === 'false' && hasOrdersFlag) continue
    if (hasMinOrMaxFilter === 'true' && !hasMinOrMaxFlag) continue
    if (hasMinOrMaxFilter === 'false' && hasMinOrMaxFlag) continue

    onHandCost += onHand * prices.unitCost
    onHandPrice += onHand * prices.unitPrice

    if (hasShortage) inShortage++
    if (hasBelowMin && !hasShortage) belowMin++

    specs.push({
      specNumber,
      companyName,
      customerSpec,
      salesRep,
      onHand,
      minQty,
      maxQty,
      unitCost: prices.unitCost,
      unitPrice: prices.unitPrice,
      last30DayUsage: usage.last30d,
      avg30DayUsage90: usage.avg30d90,
      minMonthsOfSupply,
      maxMonthsOfSupply,
      onHandMonthsOfSupply,
      hasOrders: hasOrdersFlag,
      hasMinOrMax: hasMinOrMaxFlag,
      shortageDate,
      belowMinDate,
      hasPastDues,
      buckets: specBuckets,
    })
  }

  // Compute projected 4-week values
  // Find bucket index closest to +4W from today
  const fourWeeksOut = new Date(today)
  fourWeeksOut.setDate(fourWeeksOut.getDate() + 28)
  let proj4wIdx = buckets.length - 1
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i].startDate >= fourWeeksOut) {
      proj4wIdx = Math.max(0, i - 1)
      break
    }
  }

  let projected4wCost = 0
  let projected4wPrice = 0
  for (const spec of specs) {
    const proj = spec.buckets[proj4wIdx]?.projected ?? spec.onHand
    projected4wCost += Math.max(0, proj) * spec.unitCost
    projected4wPrice += Math.max(0, proj) * spec.unitPrice
  }

  // Compute totals
  let totalOnHand = 0, totalMinQty = 0, totalMaxQty = 0, totalLast30d = 0, totalAvg30d = 0
  for (const s of specs) {
    totalOnHand += s.onHand
    totalMinQty += s.minQty
    totalMaxQty += s.maxQty
    totalLast30d += s.last30DayUsage
    totalAvg30d += s.avg30DayUsage90
  }

  return {
    bucketLabels: buckets.map(b => b.label),
    bucketDates: buckets.map(b => toISODate(b.startDate)),
    specs,
    totals: {
      totalOnHand: Math.round(totalOnHand),
      totalMinQty: Math.round(totalMinQty),
      totalMaxQty: Math.round(totalMaxQty),
      totalLast30d: Math.round(totalLast30d),
      totalAvg30d: Math.round(totalAvg30d * 10) / 10,
    },
    kpis: {
      totalSKUs: specs.length,
      inShortage,
      belowMin,
      onHandCost: Math.round(onHandCost),
      onHandPrice: Math.round(onHandPrice),
      projected4wCost: Math.round(projected4wCost),
      projected4wPrice: Math.round(projected4wPrice),
      pastDueCount,
    },
  }
}

// ── GET /projection ────────────────────────────────────────────

mrpDashboardRoutes.get('/projection', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const granularity = (c.req.query('granularity') || 'week') as Granularity
  const horizon = parseInt(c.req.query('horizon') || '12', 10)
  const company = c.req.query('company') || undefined
  const spec = c.req.query('spec') || undefined
  const filterParam = c.req.query('filter') || ''
  const activeFilters = filterParam ? filterParam.split(',') : []
  const hasOrders = c.req.query('hasOrders') || undefined
  const hasMinOrMax = c.req.query('hasMinOrMax') || undefined

  if (!['day', 'week', '2week', 'month'].includes(granularity)) {
    return c.json({ error: 'granularity must be day, week, 2week, or month' }, 400)
  }

  try {
    const kv = c.env.AUTH_CACHE

    // Parallel fetch — no data dependency between queries
    const [inventoryResult, ordersResult, pricesResult, usageResult] = await Promise.all([
      kvCache(kv, 'mrp:inventory', CacheTTL.DASHBOARD_DATA, () =>
        client.rawQuery(MRP_SQL.inventory, {}, 'esp')
      ),
      kvCache(kv, 'mrp:orders', CacheTTL.DASHBOARD_DATA, () =>
        client.rawQuery(MRP_SQL.orders, {}, 'esp')
      ),
      kvCache(kv, 'mrp:prices', CacheTTL.LOOKUP_DATA, () =>
        client.rawQuery(MRP_SQL.prices, {}, 'esp')
      ),
      kvCache(kv, 'mrp:usage', CacheTTL.DASHBOARD_DATA, () =>
        client.rawQuery(MRP_SQL.usage, {}, 'esp')
      ),
    ])

    // Build price and usage maps
    const priceMap = new Map<string, { unitCost: number; unitPrice: number }>()
    for (const row of pricesResult.data as Array<Record<string, unknown>>) {
      priceMap.set(String(row.specNumber), {
        unitCost: Number(row.unitCost) || 0,
        unitPrice: Number(row.unitPrice) || 0,
      })
    }

    const usageMap = new Map<string, { last30d: number; avg30d90: number }>()
    for (const row of usageResult.data as Array<Record<string, unknown>>) {
      usageMap.set(String(row.specNumber), {
        last30d: Number(row.last30d) || 0,
        avg30d90: Number(row.avg30d90) || 0,
      })
    }

    const buckets = buildBuckets(granularity, horizon)
    const result = computeProjection(
      inventoryResult.data as Array<Record<string, unknown>>,
      ordersResult.data as Array<Record<string, unknown>>,
      priceMap,
      usageMap,
      buckets,
      company,
      spec,
      activeFilters,
      hasOrders,
      hasMinOrMax
    )

    await logAudit(c, {
      action: 'mrp.projection.read',
      resource: 'mrp',
      metadata: { granularity, horizon, specCount: result.specs.length },
    })

    return c.json(result)
  } catch (err) {
    console.error('MRP projection error:', err)
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── GET /health-summary ────────────────────────────────────────

mrpDashboardRoutes.get('/health-summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const granularity = (c.req.query('granularity') || 'week') as Granularity
  const horizon = parseInt(c.req.query('horizon') || '12', 10)
  const company = c.req.query('company') || undefined
  const spec = c.req.query('spec') || undefined

  try {
    const kv = c.env.AUTH_CACHE

    // Reuse same cached data as /projection — avoids duplicate fetches
    const [inventoryResult, ordersResult] = await Promise.all([
      kvCache(kv, 'mrp:inventory', CacheTTL.DASHBOARD_DATA, () =>
        client.rawQuery(MRP_SQL.inventory, {}, 'esp')
      ),
      kvCache(kv, 'mrp:orders', CacheTTL.DASHBOARD_DATA, () =>
        client.rawQuery(MRP_SQL.orders, {}, 'esp')
      ),
    ])

    const buckets = buildBuckets(granularity, horizon)
    const result = computeProjection(
      inventoryResult.data as Array<Record<string, unknown>>,
      ordersResult.data as Array<Record<string, unknown>>,
      new Map(),
      new Map(),
      buckets,
      company,
      spec,
      [],
      undefined,
      undefined
    )

    // Aggregate health counts per bucket
    const healthSummary = buckets.map((b, idx) => {
      let good = 0, adequate = 0, belowMinCount = 0, shortage = 0
      for (const s of result.specs) {
        switch (s.buckets[idx].health) {
          case 'good': good++; break
          case 'adequate': adequate++; break
          case 'belowMin': belowMinCount++; break
          case 'shortage': shortage++; break
        }
      }
      return { label: b.label, date: toISODate(b.startDate), good, adequate, belowMin: belowMinCount, shortage }
    })

    return c.json({ data: healthSummary })
  } catch (err) {
    console.error('MRP health-summary error:', err)
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// ── GET /spec-detail ───────────────────────────────────────────

mrpDashboardRoutes.get('/spec-detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const spec = c.req.query('spec')
  if (!spec) {
    return c.json({ error: 'spec parameter is required' }, 400)
  }

  try {
    const [ordersResult, shipLogResult] = await Promise.all([
      client.rawQuery(MRP_SQL.specDetail_orders, { spec }, 'esp'),
      client.rawQuery(MRP_SQL.specDetail_shipLog, { spec }, 'esp'),
    ])

    const orders = ordersResult.data as Array<Record<string, unknown>>
    const openMOs = orders.filter(o => !String(o.jobNum || '').startsWith('C'))
    const callOffs = orders.filter(o => String(o.jobNum || '').startsWith('C'))

    await logAudit(c, {
      action: 'mrp.spec_detail.read',
      resource: 'mrp',
      resourceId: spec,
      metadata: { moCount: openMOs.length, callOffCount: callOffs.length },
    })

    return c.json({
      openMOs,
      callOffs,
      shipLog: shipLogResult.data,
    })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// ── GET /filter-options ────────────────────────────────────────

mrpDashboardRoutes.get('/filter-options', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'mrp:filter-options', CacheTTL.FILTER_OPTIONS, async () => {
      const [companiesResult, specsResult] = await Promise.all([
        client.rawQuery(MRP_SQL.companies, {}, 'esp'),
        client.rawQuery(MRP_SQL.specs, {}, 'esp'),
      ])
      return {
        companies: (companiesResult.data as Array<Record<string, unknown>>).map(r => String(r.companyName)),
        specs: (specsResult.data as Array<Record<string, unknown>>).map(r => String(r.specNumber)),
      }
    })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})
