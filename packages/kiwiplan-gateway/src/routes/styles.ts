import { Router, Request, Response } from 'express'
import { executeQuery } from '../db.js'
import { getQuery } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

/**
 * GET /styles
 * List active box styles (reference data)
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const query = getQuery('listStyles')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('listStyles', {}, req)

    // Execute query (no params needed - system config)
    const results = await executeQuery('listStyles', query.sql, {})

    // Log completion
    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({
      data: results,
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[STYLES] Error listing styles:', error)
    res.status(500).json({ error: 'Failed to fetch styles' })
  }
})

export default router
