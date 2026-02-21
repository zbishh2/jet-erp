import { Request, Response, NextFunction } from 'express'
import { config } from '../config.js'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Audit Log Entry
 *
 * Every database operation is logged BEFORE execution.
 * This provides a complete audit trail of all queries.
 *
 * IMPORTANT: Logs are written to disk (durable) AND kept in memory (for API).
 * Log files are stored in ./logs/ with daily rotation.
 */
export interface AuditLogEntry {
  id: string
  timestamp: string
  operation: string
  params: Record<string, unknown>
  userId: string | null
  ipAddress: string
  userAgent: string
  approved: boolean
  executionTimeMs?: number
  rowCount?: number
  error?: string
}

// In-memory log (recent entries for API access)
const auditLog: AuditLogEntry[] = []
const MAX_MEMORY_ENTRIES = 1000

// Log directory
const LOG_DIR = path.join(process.cwd(), 'logs')

/**
 * Ensure log directory exists
 */
function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  }
}

/**
 * Get today's log file path
 */
function getLogFilePath(): string {
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD
  return path.join(LOG_DIR, `audit-${today}.log`)
}

/**
 * Append entry to log file (durable storage)
 */
function writeToFile(entry: AuditLogEntry): void {
  try {
    ensureLogDir()
    const logLine = JSON.stringify(entry) + '\n'
    fs.appendFileSync(getLogFilePath(), logLine, 'utf8')
  } catch (err) {
    // Don't crash if logging fails, but warn
    console.error('[AUDIT] Failed to write to log file:', err)
  }
}

function generateId(): string {
  return `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Log an operation BEFORE execution
 *
 * This is called BEFORE any database query runs.
 * The entry is written to disk immediately for durability.
 */
export function logOperationStart(
  operation: string,
  params: Record<string, unknown>,
  req: Request
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    operation,
    params: sanitizeParams(params),
    userId: req.headers['x-user-id'] as string || null,
    ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    approved: true,
  }

  // Write to file FIRST (durable)
  writeToFile(entry)

  // Then add to memory (for API access)
  auditLog.push(entry)
  if (auditLog.length > MAX_MEMORY_ENTRIES) {
    auditLog.shift() // Remove oldest
  }

  if (config.logQueries) {
    console.log('[AUDIT] Operation started:', entry.operation, entry.params)
  }

  return entry
}

/**
 * Update log entry after execution
 */
export function logOperationComplete(
  entry: AuditLogEntry,
  rowCount: number,
  executionTimeMs: number
): void {
  entry.rowCount = rowCount
  entry.executionTimeMs = executionTimeMs

  // Write completion to file
  writeToFile({
    ...entry,
    id: entry.id + '_complete',
  })

  if (config.logQueries) {
    console.log(`[AUDIT] Operation complete: ${entry.operation} - ${rowCount} rows in ${executionTimeMs}ms`)
  }
}

/**
 * Log operation failure
 */
export function logOperationError(entry: AuditLogEntry, error: Error): void {
  entry.error = error.message

  // Write error to file
  writeToFile({
    ...entry,
    id: entry.id + '_error',
  })

  console.error(`[AUDIT] Operation failed: ${entry.operation}`, error.message)
}

/**
 * Log a rejected/blocked operation (e.g., query not in allowlist)
 */
export function logOperationRejected(
  operation: string,
  reason: string,
  req: Request
): void {
  const entry: AuditLogEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    operation,
    params: {},
    userId: req.headers['x-user-id'] as string || null,
    ipAddress: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
    approved: false,
    error: reason,
  }

  writeToFile(entry)
  auditLog.push(entry)

  console.warn(`[AUDIT] Operation REJECTED: ${operation} - ${reason}`)
}

/**
 * Remove sensitive data from params before logging
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...params }

  // Don't log passwords or tokens
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization']
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]'
    }
  }

  return sanitized
}

/**
 * Get recent audit logs (for debugging/monitoring)
 */
export function getRecentLogs(limit = 100): AuditLogEntry[] {
  return auditLog.slice(-limit)
}

/**
 * Get log file path for external access
 */
export function getLogDirectory(): string {
  return LOG_DIR
}

/**
 * Middleware to attach audit context to request
 */
export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Attach audit helper to request
  (req as any).audit = {
    start: (operation: string, params: Record<string, unknown>) =>
      logOperationStart(operation, params, req),
    complete: logOperationComplete,
    error: logOperationError,
    reject: (operation: string, reason: string) =>
      logOperationRejected(operation, reason, req),
  }

  next()
}
