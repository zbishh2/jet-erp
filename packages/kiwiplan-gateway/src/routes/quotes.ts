import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery, applyCompanyFilter, validateParams, validateCompanyScope } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

// Validation schemas
const listQuotesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  companyId: z.coerce.number().int().optional(),
})

const getQuoteSchema = z.object({
  quoteId: z.coerce.number().int(),
})

const getQuoteQuerySchema = z.object({
  companyId: z.coerce.number().int().optional(),
})

/**
 * GET /quotes
 * List quotes with pagination
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    // Validate request params
    const parsed = listQuotesSchema.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { page, pageSize, companyId } = parsed.data
    const offset = (page - 1) * pageSize

    // Get the allowed query
    const query = getQuery('listQuotes')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    // Build params with company filter
    const params = applyCompanyFilter({
      limit: pageSize,
      offset,
      companyId,
    })

    // Validate required params
    const validation = validateParams(query, params)
    if (!validation.valid) {
      res.status(400).json({ error: 'Missing parameters', missing: validation.missing })
      return
    }

    // Validate company scope (required in prod)
    const scopeValidation = validateCompanyScope(params, 'listQuotes')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('listQuotes', params, req)

    // Execute query
    const results = await executeQuery('listQuotes', query.sql, params)

    // Log completion
    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({
      data: results,
      page,
      pageSize,
      // Note: total count requires separate query
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[QUOTES] Error listing quotes:', error)
    res.status(500).json({ error: 'Failed to fetch quotes' })
  }
})

/**
 * GET /quotes/:quoteId
 * Get single quote with product designs
 */
router.get('/:quoteId', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry: ReturnType<typeof logOperationStart> | undefined
  let productsAuditEntry: ReturnType<typeof logOperationStart> | undefined

  try {
    // Validate params
    const parsed = getQuoteSchema.safeParse(req.params)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid quote ID' })
      return
    }

    const queryParsed = getQuoteQuerySchema.safeParse(req.query)
    if (!queryParsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }

    const { quoteId } = parsed.data
    const { companyId } = queryParsed.data

    // Get quote
    const quoteQuery = getQuery('getQuote')
    const productsQuery = getQuery('getQuoteProducts')

    if (!quoteQuery || !productsQuery) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    const params = applyCompanyFilter({ quoteId, companyId })

    // Validate company scope (required in prod)
    const scopeValidation = validateCompanyScope(params, 'getQuote')
    if (!scopeValidation.valid) {
      res.status(400).json({ error: scopeValidation.error })
      return
    }

    // Log BEFORE execution - separate audit for each query
    auditEntry = logOperationStart('getQuote', params, req)
    productsAuditEntry = logOperationStart('getQuoteProducts', params, req)

    // Execute queries (both use company filter)
    const [quotes, products] = await Promise.all([
      executeQuery('getQuote', quoteQuery.sql, params),
      executeQuery('getQuoteProducts', productsQuery.sql, params),
    ])

    if (quotes.length === 0) {
      logOperationComplete(auditEntry, 0, Date.now() - startTime)
      logOperationComplete(productsAuditEntry, 0, Date.now() - startTime)
      res.status(404).json({ error: 'Quote not found' })
      return
    }

    // Log completion for both queries
    logOperationComplete(auditEntry, 1, Date.now() - startTime)
    logOperationComplete(productsAuditEntry, products.length, Date.now() - startTime)

    const quote = quotes[0] as Record<string, unknown>
    res.json({
      data: {
        ...quote,
        products,
      },
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    if (productsAuditEntry) {
      logOperationError(productsAuditEntry, error as Error)
    }
    console.error('[QUOTES] Error fetching quote:', error)
    res.status(500).json({ error: 'Failed to fetch quote' })
  }
})

export default router
