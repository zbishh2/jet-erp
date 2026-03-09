import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'
import { kvCache, CacheTTL } from '../services/kv-cache'
import { logAudit } from '../services/audit'
import { eq } from 'drizzle-orm'
import { plantTvGoal } from '../db/schema'

export const plantTvDashboardRoutes = new Hono<{ Bindings: Env }>()

function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

const QUERIES = {
  /**
   * Aggregated sheets/order-hour by machine, date, shift.
   *
   * Matches PBI formula:
   *   Sheets/Order Hour = SUM(quantity_fed_in) / (SUM(Order Duration) / 3600)
   *   Order Duration = DATEDIFF(SECOND, feedback_start, feedback_finish)
   */
  /**
   * Shift derived from feedback_start hour against dwshiftcalendar:
   *   First  = 06:00–16:00
   *   Second = 16:00–22:00
   *   Other  = outside shift hours (GAP / closed)
   */
  tvData: `
    SELECT
      CONVERT(VARCHAR(10), pf.feedback_report_date, 23) as feedbackDate,
      cc.costcenter_number as lineNumber,
      cc.costcenter_name as lineName,
      CASE
        WHEN DATEPART(HOUR, jss.feedback_start) >= 6 AND DATEPART(HOUR, jss.feedback_start) < 16 THEN 'First'
        WHEN DATEPART(HOUR, jss.feedback_start) >= 16 AND DATEPART(HOUR, jss.feedback_start) < 22 THEN 'Second'
        ELSE 'Other'
      END as shiftName,
      SUM(CAST(pf.quantity_fed_in AS FLOAT)) as totalSheetsFed,
      SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT)) / 3600.0 as totalOrderHours,
      CASE
        WHEN SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT)) > 0
        THEN SUM(CAST(pf.quantity_fed_in AS FLOAT)) / (SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT)) / 3600.0)
        ELSE 0
      END as sheetsPerOrderHour
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    WHERE pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate
      AND pf.actual_run_duration_minutes != 0
      AND cc.costcenter_number IN (131, 132, 133, 142, 144, 146, 154)
    GROUP BY pf.feedback_report_date, cc.costcenter_number, cc.costcenter_name,
      CASE
        WHEN DATEPART(HOUR, jss.feedback_start) >= 6 AND DATEPART(HOUR, jss.feedback_start) < 16 THEN 'First'
        WHEN DATEPART(HOUR, jss.feedback_start) >= 16 AND DATEPART(HOUR, jss.feedback_start) < 22 THEN 'Second'
        ELSE 'Other'
      END
    ORDER BY pf.feedback_report_date DESC, cc.costcenter_number, shiftName
  `,

  shifts: `
    SELECT 'First' as shiftName UNION ALL SELECT 'Second'
  `,
}

// ── GET /data ─────────────────────────────────────────────────────────
plantTvDashboardRoutes.get('/data', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate required' }, 400)
  }

  const cacheKey = `plant-tv:data:${startDate}:${endDate}`

  try {
    const rows = await kvCache(
      c.env.AUTH_CACHE,
      cacheKey,
      300, // 5 minutes - matches TV refresh interval
      async () => {
        const result = await client.rawQuery(
          QUERIES.tvData,
          { startDate, endDate },
          'kdw'
        )
        return result.data || []
      }
    )

    return c.json({ rows })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, 502)
    }
    throw err
  }
})

// ── POST /query — KDW query endpoint for diagnostics ──────────────────
plantTvDashboardRoutes.post('/query', async (c) => {
  const auth = c.get('auth') as any
  if (!auth?.roles?.includes('ADMIN')) {
    return c.json({ error: 'ADMIN role required' }, 403)
  }
  const client = getClient(c.env)
  if (!client) return c.json({ error: 'Kiwiplan not configured' }, 503)

  const body = await c.req.json<{ sql: string; database?: 'kdw' | 'esp' }>()
  if (!body.sql?.trim().toUpperCase().startsWith('SELECT')) {
    return c.json({ error: 'Only SELECT queries allowed' }, 400)
  }

  try {
    const result = await client.rawQuery(body.sql, {}, body.database ?? 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) return c.json({ error: err.message }, 502)
    throw err
  }
})

// ── GET /shifts ───────────────────────────────────────────────────────
plantTvDashboardRoutes.get('/shifts', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan not configured' }, 503)
  }

  const cacheKey = 'plant-tv:shifts'

  try {
    const rows = await kvCache(
      c.env.AUTH_CACHE,
      cacheKey,
      CacheTTL.FILTER_OPTIONS,
      async () => {
        const result = await client.rawQuery(QUERIES.shifts, {}, 'kdw')
        return result.data || []
      }
    )

    return c.json({ shifts: rows.map((r: any) => r.shiftName) })
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, 502)
    }
    throw err
  }
})

// ── GET /goals ────────────────────────────────────────────────────────
plantTvDashboardRoutes.get('/goals', async (c) => {
  const db = c.get('db')
  const goals = await db.select().from(plantTvGoal).all()
  return c.json({ goals })
})

// ── PUT /goals ────────────────────────────────────────────────────────
plantTvDashboardRoutes.put('/goals', async (c) => {
  const auth = c.get('auth') as any
  if (!auth?.roles?.includes('ADMIN')) {
    return c.json({ error: 'ADMIN role required' }, 403)
  }

  const db = c.get('db')
  const body = await c.req.json<{
    goals: Array<{
      machine: number
      pct85: number
      pct90: number
      pct100: number
      pct112: number
    }>
  }>()

  if (!body.goals || !Array.isArray(body.goals)) {
    return c.json({ error: 'goals array required' }, 400)
  }

  const now = new Date().toISOString()

  // Upsert each goal row
  for (const g of body.goals) {
    const existing = await db
      .select()
      .from(plantTvGoal)
      .where(eq(plantTvGoal.machine, g.machine))
      .get()

    if (existing) {
      await db
        .update(plantTvGoal)
        .set({
          pct85: g.pct85,
          pct90: g.pct90,
          pct100: g.pct100,
          pct112: g.pct112,
          updatedAt: now,
        })
        .where(eq(plantTvGoal.machine, g.machine))
        .run()
    } else {
      await db
        .insert(plantTvGoal)
        .values({
          id: crypto.randomUUID(),
          machine: g.machine,
          pct85: g.pct85,
          pct90: g.pct90,
          pct100: g.pct100,
          pct112: g.pct112,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }
  }

  await logAudit(c, {
    action: 'plant-tv-goals.update',
    resource: 'plant-tv-goal',
    metadata: { machineCount: body.goals.length },
  })

  const updated = await db.select().from(plantTvGoal).all()
  return c.json({ goals: updated })
})
