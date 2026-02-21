import { Router, Request, Response } from 'express'
import { executeQuery } from '../db.js'
import { getQuery } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

/**
 * GET /inks
 * List active inks/colors (reference data)
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const query = getQuery('listInks')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    // Log BEFORE execution
    auditEntry = logOperationStart('listInks', {}, req)

    // Execute query (no params needed - system config)
    const results = await executeQuery('listInks', query.sql, {})

    // Log completion
    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({
      data: results,
    })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[INKS] Error listing inks:', error)
    res.status(500).json({ error: 'Failed to fetch inks' })
  }
})

export default router
