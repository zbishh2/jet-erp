import sql from 'mssql'
import { config } from './config.js'
import { ALLOWED_QUERIES, isUnscopedQuery } from './middleware/validate.js'

let pool: sql.ConnectionPool | null = null

export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool) {
    return pool
  }

  console.log(`[DB] Connecting to ${config.db.server}/${config.db.database}...`)

  pool = await sql.connect({
    server: config.db.server,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    options: config.db.options,
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
  })

  console.log(`[DB] Connected successfully`)

  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close()
    pool = null
    console.log('[DB] Connection closed')
  }
}

/**
 * Execute a parameterized query
 *
 * IMPORTANT: This is the ONLY way to execute queries.
 * Never use string concatenation for parameters.
 *
 * SECURITY: Only queries defined in ALLOWED_QUERIES can be executed.
 * The queryText must match exactly what's in the allowlist.
 */
export async function executeQuery<T>(
  queryName: string,
  queryText: string,
  params: Record<string, unknown>
): Promise<T[]> {
  // HARD GUARD: Verify query is in allowlist
  const allowedQuery = ALLOWED_QUERIES[queryName]
  if (!allowedQuery) {
    throw new Error(`SECURITY: Query "${queryName}" is not in the allowlist`)
  }

  // HARD GUARD: Verify queryText matches allowlist exactly
  // Normalize whitespace for comparison
  const normalizeSQL = (sql: string) => sql.replace(/\s+/g, ' ').trim()
  if (normalizeSQL(queryText) !== normalizeSQL(allowedQuery.sql)) {
    throw new Error(`SECURITY: Query "${queryName}" SQL does not match allowlist`)
  }

  // Log warning for unscoped queries (system config data)
  if (isUnscopedQuery(queryName)) {
    console.warn(`[DB] Executing UNSCOPED query: ${queryName} (system config data, not filtered by company)`)
  }

  const db = await getPool()
  const request = db.request()

  // Bind all parameters
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value)
  }

  const result = await request.query(queryText)
  return result.recordset as T[]
}
