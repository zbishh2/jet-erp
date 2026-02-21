import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery, applyCompanyFilter, validateCompanyScope } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

// Validation schemas
const getProductCostSchema = z.object({
  productDesignId: z.coerce.number().int(),
})

const getProductCostQuerySchema = z.object({
  companyId: z.coerce.number().int().optional(),
})

/**
 * GET /costing/rules
 * Get all active cost rules
 */
router.get('/rules', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const query = getQuery('getCostRules')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('getCostRules', {}, req)

    // Execute query
    const results = await executeQuery('getCostRules', query.sql, {})

    // Log completion
    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({
      data: results,
      count: results.length,
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[COSTING] Error fetching cost rules:', error)
    res.status(500).json({ error: 'Failed to fetch cost rules' })
  }
})

/**
 * GET /costing/estimate/:productDesignId
 * Get cost estimate for a product design
 */
router.get('/estimate/:productDesignId', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    // Validate params
    const parsed = getProductCostSchema.safeParse(req.params)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid product design ID' })
      return
    }

    const queryParsed = getProductCostQuerySchema.safeParse(req.query)
    if (!queryParsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }

    const { productDesignId } = parsed.data
    const { companyId } = queryParsed.data

    const query = getQuery('getProductCostEstimate')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    // Apply company filter for dev mode safety
    const params = applyCompanyFilter({ productDesignId, companyId })

    // Validate company scope (required in prod)
    const scopeValidation = validateCompanyScope(params, 'getProductCostEstimate')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('getProductCostEstimate', params, req)

    // Execute query
    const results = await executeQuery('getProductCostEstimate', query.sql, params)

    // Log completion
    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    if (results.length === 0) {
      res.status(404).json({ error: 'Cost estimate not found' })
      return
    }

    res.json({
      data: results[0],
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[COSTING] Error fetching cost estimate:', error)
    res.status(500).json({ error: 'Failed to fetch cost estimate' })
  }
})

export default router
