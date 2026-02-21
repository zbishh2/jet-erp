import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery, applyCompanyFilter, validateParams, validateCompanyScope } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

// Validation schemas
const listAddressesSchema = z.object({
  customerId: z.coerce.number().int(),
})

const getFreightZoneSchema = z.object({
  deliveryRegionId: z.coerce.number().int(),
})

const getDespatchModeParamsSchema = z.object({
  id: z.coerce.number().int(),
})

/**
 * GET /addresses?customerId=123
 * List all addresses for a customer
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = listAddressesSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { customerId } = parsed.data

    const query = getQuery('listCustomerAddresses')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = { customerId }

    const validation = validateParams(query, params)
    if (!validation.valid) {
      res.status(400).json({ error: 'Missing parameters', missing: validation.missing })
      return
    }

    auditEntry = logOperationStart('listCustomerAddresses', params, req)

    const results = await executeQuery('listCustomerAddresses', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[ADDRESSES] Error listing addresses:', error)
    res.status(500).json({ error: 'Failed to fetch addresses' })
  }
})

/**
 * GET /addresses/freight-zone?deliveryRegionId=456
 * Get freight zone for a delivery region
 */
router.get('/freight-zone', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = getFreightZoneSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { deliveryRegionId } = parsed.data

    const query = getQuery('getFreightZone')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = { deliveryRegionId }

    const validation = validateParams(query, params)
    if (!validation.valid) {
      res.status(400).json({ error: 'Missing parameters', missing: validation.missing })
      return
    }

    auditEntry = logOperationStart('getFreightZone', params, req)

    const results = await executeQuery('getFreightZone', query.sql, params)

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results.length > 0 ? results[0] : null })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[ADDRESSES] Error fetching freight zone:', error)
    res.status(500).json({ error: 'Failed to fetch freight zone' })
  }
})

/**
 * GET /addresses/despatch-mode/:id
 * Get despatch mode details
 */
router.get('/despatch-mode/:id', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = getDespatchModeParamsSchema.safeParse(req.params)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid despatch mode ID' })
      return
    }

    const query = getQuery('getDespatchMode')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = { despatchModeId: parsed.data.id }

    auditEntry = logOperationStart('getDespatchMode', params, req)

    const results = await executeQuery('getDespatchMode', query.sql, params)

    if (results.length === 0) {
      res.status(404).json({ error: 'Despatch mode not found' })
      return
    }

    logOperationComplete(auditEntry, 1, Date.now() - startTime)

    res.json({ data: results[0] })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[ADDRESSES] Error fetching despatch mode:', error)
    res.status(500).json({ error: 'Failed to fetch despatch mode' })
  }
})

export default router
