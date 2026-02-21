import { createMiddleware } from 'hono/factory'
import type { AuthContext } from '../types/auth'

// Strict UUID v4 validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Validate that a string is a valid UUID format.
 */
export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}

/**
 * Tenant middleware for Cloudflare Workers.
 *
 * Note: D1/SQLite doesn't support session variables like PostgreSQL.
 * Tenant isolation is handled at the application level by filtering
 * queries with organizationId from the auth context.
 */
export const tenantMiddleware = createMiddleware(async (c, next) => {
  const auth = c.get('auth') as AuthContext | undefined

  if (!auth?.organizationId) {
    return c.json({ error: 'No organization context' }, 403)
  }

  if (!isValidUuid(auth.organizationId)) {
    return c.json({ error: 'Invalid organization context' }, 400)
  }

  return next()
})
