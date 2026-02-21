import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery, applyCompanyFilter, validateParams, validateCompanyScope } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

// Validation schemas
const listCustomersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  companyId: z.coerce.number().int().optional(),
})

const getCustomerSchema = z.object({
  customerId: z.coerce.number().int(),
})

const getCustomerQuerySchema = z.object({
  companyId: z.coerce.number().int().optional(),
})

/**
 * GET /customers
 * List customers with pagination and search
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    // Validate request params
    const parsed = listCustomersSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { page, pageSize, search, companyId } = parsed.data
    const offset = (page - 1) * pageSize

    // Get the allowed query
    const query = getQuery('listCustomers')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    // Build params with company filter
    const params = applyCompanyFilter({
      limit: pageSize,
      offset,
      search: search || null,
      companyId,
    })

    // Validate required params
    const validation = validateParams(query, params)
    if (!validation.valid) {
      res.status(400).json({ error: 'Missing parameters', missing: validation.missing })
      return
    }

    // Validate company scope (required in prod)
    const scopeValidation = validateCompanyScope(params, 'listCustomers')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('listCustomers', params, req)

    // Execute query
    const results = await executeQuery('listCustomers', query.sql, params)

    // Log completion
    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({
      data: results,
      page,
      pageSize,
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[CUSTOMERS] Error listing customers:', error)
    res.status(500).json({ error: 'Failed to fetch customers' })
  }
})

/**
 * GET /customers/:customerId
 * Get single customer details
 */
router.get('/:customerId', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    // Validate params
    const parsed = getCustomerSchema.safeParse(req.params)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid customer ID' })
      return
    }

    const queryParsed = getCustomerQuerySchema.safeParse(req.query)
    if (!queryParsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }

    const { customerId } = parsed.data
    const { companyId } = queryParsed.data

    // Get query
    const query = getQuery('getCustomer')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = applyCompanyFilter({ customerId, companyId })

    // Validate company scope (required in prod)
    const scopeValidation = validateCompanyScope(params, 'getCustomer')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('getCustomer', params, req)

    // Execute query
    const results = await executeQuery('getCustomer', query.sql, params)

    if (results.length === 0) {
      res.status(404).json({ error: 'Customer not found' })
      return
    }

    // Log completion
    logOperationComplete(auditEntry, 1, Date.now() - startTime)

    res.json({
      data: results[0],
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[CUSTOMERS] Error fetching customer:', error)
    res.status(500).json({ error: 'Failed to fetch customer' })
  }
})

export default router
