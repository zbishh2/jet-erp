import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

// Validation schemas
const varianceSummarySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  orderNumber: z.string().optional(),
})

/**
 * GET /cost-analysis/variance
 * Pre vs post cost variance per order, sorted by largest absolute variance.
 *
 * All costs are converted from per-M to order-level: (costPerM / 1000) * qty
 *
 * Includes rate/quantity variance decomposition:
 *   rateVariance     = how much is due to cost-per-M changing (at pre qty)
 *   quantityVariance = how much is due to qty changing (at pre rate)
 *
 * Optional filter: ?orderNumber=14363
 */
router.get('/variance', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = varianceSummarySchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { page, pageSize, orderNumber } = parsed.data
    const offset = (page - 1) * pageSize

    const query = getQuery('getCostVarianceSummary')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = {
      limit: pageSize,
      offset,
      orderNumber: orderNumber || null,
    }

    auditEntry = logOperationStart('getCostVarianceSummary', params, req)

    const results = await executeQuery('getCostVarianceSummary', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results, page, pageSize })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[COST-ANALYSIS] Error fetching variance summary:', error)
    res.status(500).json({ error: 'Failed to fetch cost variance summary' })
  }
})

/**
 * GET /cost-analysis/stats
 * Aggregate cost variance statistics across all post-costed orders.
 *
 * Returns one row with:
 *   - Order counts (total, over-estimate, under-estimate)
 *   - Average pre/post order cost
 *   - Average variance by cost category (material, labour, freight, etc.)
 *   - Rate vs quantity variance decomposition (averages)
 *   - Max overrun and underrun
 */
router.get('/stats', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const query = getQuery('getCostVarianceStats')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    auditEntry = logOperationStart('getCostVarianceStats', {}, req)

    const results = await executeQuery('getCostVarianceStats', query.sql, {})

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results[0] || null })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[COST-ANALYSIS] Error fetching variance stats:', error)
    res.status(500).json({ error: 'Failed to fetch cost variance statistics' })
  }
})

/**
 * GET /cost-analysis/trend
 * Monthly trend of cost variance, grouped by pre-cost estimate date.
 *
 * Shows whether estimating accuracy is improving or degrading over time.
 * Each row is one month with avg variance, category breakdown, and
 * rate vs quantity decomposition.
 */
router.get('/trend', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const query = getQuery('getCostVarianceTrend')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    auditEntry = logOperationStart('getCostVarianceTrend', {}, req)

    const results = await executeQuery('getCostVarianceTrend', query.sql, {})

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[COST-ANALYSIS] Error fetching variance trend:', error)
    res.status(500).json({ error: 'Failed to fetch cost variance trend' })
  }
})

export default router
