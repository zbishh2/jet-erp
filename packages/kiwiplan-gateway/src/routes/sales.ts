import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

// Validation schemas
const dateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
})

const byCustomerSchema = dateRangeSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).default(50),
})

/**
 * GET /sales/monthly-summary?startDate=2025-01-01&endDate=2026-01-01
 * Monthly aggregation of sales data.
 */
router.get('/monthly-summary', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = dateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { startDate, endDate } = parsed.data

    const query = getQuery('getSalesMonthlySummary')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = { startDate, endDate }
    auditEntry = logOperationStart('getSalesMonthlySummary', params, req)

    const results = await executeQuery('getSalesMonthlySummary', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[SALES] Error fetching monthly summary:', error)
    res.status(500).json({ error: 'Failed to fetch sales monthly summary' })
  }
})

/**
 * GET /sales/by-rep?startDate=2025-01-01&endDate=2026-01-01
 * Sales aggregated by sales rep.
 */
router.get('/by-rep', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = dateRangeSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { startDate, endDate } = parsed.data

    const query = getQuery('getSalesByRep')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = { startDate, endDate }
    auditEntry = logOperationStart('getSalesByRep', params, req)

    const results = await executeQuery('getSalesByRep', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[SALES] Error fetching sales by rep:', error)
    res.status(500).json({ error: 'Failed to fetch sales by rep' })
  }
})

/**
 * GET /sales/by-customer?startDate=2025-01-01&endDate=2026-01-01&limit=50
 * Sales aggregated by customer.
 */
router.get('/by-customer', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = byCustomerSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { startDate, endDate } = parsed.data

    const query = getQuery('getSalesByCustomer')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = { startDate, endDate }
    auditEntry = logOperationStart('getSalesByCustomer', params, req)

    const results = await executeQuery('getSalesByCustomer', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    // Apply limit client-side since the SQL uses ORDER BY without TOP/OFFSET
    const limited = results.slice(0, parsed.data.limit)
    res.json({ data: limited })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[SALES] Error fetching sales by customer:', error)
    res.status(500).json({ error: 'Failed to fetch sales by customer' })
  }
})

/**
 * GET /sales/reps
 * Distinct sales reps for filter dropdowns.
 */
router.get('/reps', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const query = getQuery('getSalesRepList')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    auditEntry = logOperationStart('getSalesRepList', {}, req)

    const results = await executeQuery('getSalesRepList', query.sql, {})

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[SALES] Error fetching sales reps:', error)
    res.status(500).json({ error: 'Failed to fetch sales reps' })
  }
})

export default router
