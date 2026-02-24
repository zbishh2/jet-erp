import type { Context } from 'hono'
import type { Database } from '../db'
import type { Env } from '../types/bindings'
import { auditLog, authEvent } from '../db/schema'
import { generateUUID, now } from '../utils'
import { getClientIp } from './rate-limit'

/**
 * Log a business operation to the audit_log table.
 * Call this from route handlers for mutations and sensitive reads.
 *
 * @example
 *   await logAudit(c, { action: 'user.invite', resource: 'invite', resourceId: invite.id, metadata: { email, role } })
 */
export async function logAudit(
  c: Context<{ Bindings: Env }>,
  entry: {
    action: string
    resource: string
    resourceId?: string
    metadata?: Record<string, unknown>
  }
): Promise<void> {
  try {
    const db: Database = c.get('db')
    const auth = c.get('auth') as { userId?: string } | undefined

    await db.insert(auditLog).values({
      id: generateUUID(),
      userId: auth?.userId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: getClientIp(c),
      userAgent: c.req.header('User-Agent') ?? null,
      createdAt: now(),
    })
  } catch (err) {
    // Audit logging should never break the request
    console.error('[AUDIT] Failed to write audit log:', err)
  }
}

/**
 * Log an authentication event (login, logout, failure, lockout, etc.)
 * Call this from auth routes.
 *
 * @example
 *   await logAuthEvent(c, db, { eventType: 'login_failed', email, success: false, failureReason: 'invalid_password' })
 */
export async function logAuthEvent(
  c: Context<{ Bindings: Env }>,
  db: Database,
  entry: {
    eventType: string
    email?: string
    userId?: string
    success: boolean
    failureReason?: string
  }
): Promise<void> {
  try {
    await db.insert(authEvent).values({
      id: generateUUID(),
      eventType: entry.eventType,
      email: entry.email?.toLowerCase() ?? null,
      userId: entry.userId ?? null,
      success: entry.success,
      failureReason: entry.failureReason ?? null,
      ipAddress: getClientIp(c),
      userAgent: c.req.header('User-Agent') ?? null,
      createdAt: now(),
    })
  } catch (err) {
    // Auth event logging should never break the request
    console.error('[AUDIT] Failed to write auth event:', err)
  }
}
