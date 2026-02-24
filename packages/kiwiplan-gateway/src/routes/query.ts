import { Router, Request, Response } from 'express'
import sql from 'mssql'
import { getPool, getKdwPool } from '../db.js'
import { logOperationStart, logOperationComplete, logOperationError, logOperationRejected } from '../middleware/audit.js'

const VALID_DATABASES = ['esp', 'kdw'] as const
type DatabaseTarget = typeof VALID_DATABASES[number]

const router = Router()

/**
 * Forbidden SQL patterns — reject anything that isn't a pure read.
 * The DB user is read-only, but defense in depth.
 */
const FORBIDDEN_PATTERNS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bCREATE\b/i,
  /\bTRUNCATE\b/i,
  /\bEXEC\b/i,
  /\bEXECUTE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bDENY\b/i,
  /\bxp_/i,
  /\bsp_/i,
]

function isReadOnlySQL(sqlText: string): boolean {
  // Must start with SELECT or WITH (CTEs)
  const trimmed = sqlText.trim()
  if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
    return false
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false
    }
  }

  return true
}

/**
 * POST /query
 *
 * Generic SQL query endpoint. Accepts parameterized SELECT queries
 * from the CF Worker. The DB user is read-only so writes are blocked
 * at both the application and database level.
 *
 * Body: { sql: string, params?: Record<string, unknown>, database?: "esp" | "kdw" }
 * Returns: { data: rows[] }
 */
router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now()
  let auditEntry

  try {
    const { sql: sqlText, params = {}, database = 'esp' } = req.body || {}

    if (!sqlText || typeof sqlText !== 'string') {
      res.status(400).json({ error: 'sql is required and must be a string' })
      return
    }

    if (typeof params !== 'object' || Array.isArray(params)) {
      res.status(400).json({ error: 'params must be an object' })
      return
    }

    // Validate database target
    if (!VALID_DATABASES.includes(database as DatabaseTarget)) {
      res.status(400).json({ error: `database must be one of: ${VALID_DATABASES.join(', ')}` })
      return
    }

    // Validate read-only
    if (!isReadOnlySQL(sqlText)) {
      logOperationRejected('rawQuery', 'SQL is not read-only', req)
      res.status(403).json({ error: 'Only SELECT queries are allowed' })
      return
    }

    // Truncate SQL for audit log (keep first 200 chars)
    const sqlPreview = sqlText.trim().substring(0, 200)
    auditEntry = logOperationStart('rawQuery', { sqlPreview, database, ...params }, req)

    const db = database === 'kdw' ? await getKdwPool() : await getPool()
    const request = db.request()

    // Bind parameters
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value)
    }

    const result = await request.query(sqlText)

    logOperationComplete(auditEntry, result.recordset.length, Date.now() - startTime)

    res.json({ data: result.recordset })
  } catch (error) {
    if (auditEntry) {
      logOperationError(auditEntry, error as Error)
    }
    console.error('[QUERY] Error executing raw query:', error)
    res.status(500).json({ error: 'Query execution failed' })
  }
})

export default router
