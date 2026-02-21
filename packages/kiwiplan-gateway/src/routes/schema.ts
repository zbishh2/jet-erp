import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { executeQuery } from '../db.js'
import { getQuery } from '../middleware/validate.js'
import { logOperationStart, logOperationComplete, logOperationError } from '../middleware/audit.js'

const router = Router()

const exploreSchemaParams = z.object({
  pattern: z.string().min(1).max(50),
})

const exploreColumnsParams = z.object({
  tableName: z.string().min(1).max(100),
})

/**
 * GET /schema/tables?pattern=cost
 * Find tables matching a pattern
 */
router.get('/tables', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = exploreSchemaParams.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { pattern } = parsed.data

    const query = getQuery('exploreSchema')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    auditEntry = logOperationStart('exploreSchema', { pattern }, req)

    const results = await executeQuery('exploreSchema', query.sql, { pattern })

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[SCHEMA] Error exploring tables:', error)
    res.status(500).json({ error: 'Failed to explore schema' })
  }
})

/**
 * GET /schema/columns?tableName=cstCostRule
 * Get columns for a specific table
 */
router.get('/columns', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const parsed = exploreColumnsParams.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid parameters', details: parsed.error.flatten() })
      return
    }

    const { tableName } = parsed.data

    const query = getQuery('exploreColumns')
    if (!query) {
      res.status(500).json({ error: 'Query not configured' })
      return
    }

    auditEntry = logOperationStart('exploreColumns', { tableName }, req)

    const results = await executeQuery('exploreColumns', query.sql, { tableName })

    logOperationComplete(auditEntry, results.length, Date.now() - startTime)

    res.json({ data: results, tableName })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[SCHEMA] Error exploring columns:', error)
    res.status(500).json({ error: 'Failed to explore columns' })
  }
})

export default router
