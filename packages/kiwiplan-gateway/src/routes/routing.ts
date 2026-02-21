import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery, applyCompanyFilter, validateParams, validateCompanyScope } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

const getRoutingSchema = z.object({
  productDesignId: z.coerce.number().int(),
  companyId: z.coerce.number().int().optional(),
})

const getRoutingByStyleSchema = z.object({
  styleId: z.coerce.number().int(),
  companyId: z.coerce.number().int().optional(),
})

/**
 * GET /routing?productDesignId=789
 * Get machine routing steps for a product design
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = getRoutingSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { productDesignId, companyId } = parsed.data

    const query = getQuery('getRouting')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = applyCompanyFilter({ productDesignId, companyId })

    const validation = validateParams(query, params)
    if (!validation.valid) {
      res.status(400).json({ error: 'Missing parameters', missing: validation.missing })
      return
    }

    const scopeValidation = validateCompanyScope(params, 'getRouting')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    auditEntry = logOperationStart('getRouting', params, req)

    const results = await executeQuery('getRouting', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[ROUTING] Error fetching routing:', error)
    res.status(500).json({ error: 'Failed to fetch routing' })
  }
})

/**
 * GET /by-style?styleId=123
 * Get machine routing steps from the most recent product design for a box style
 */
router.get('/by-style', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = getRoutingByStyleSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { styleId, companyId } = parsed.data

    const query = getQuery('getRoutingByStyle')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = applyCompanyFilter({ styleId, companyId })

    const validation = validateParams(query, params)
    if (!validation.valid) {
      res.status(400).json({ error: 'Missing parameters', missing: validation.missing })
      return
    }

    const scopeValidation = validateCompanyScope(params, 'getRoutingByStyle')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    auditEntry = logOperationStart('getRoutingByStyle', params, req)

    const results = await executeQuery('getRoutingByStyle', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[ROUTING] Error fetching routing by style:', error)
    res.status(500).json({ error: 'Failed to fetch routing by style' })
  }
})

export default router
