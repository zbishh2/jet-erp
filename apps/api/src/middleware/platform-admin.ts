import { createMiddleware } from 'hono/factory'
import type { Env } from '../types/bindings'

/**
 * Middleware that checks if the authenticated user is a platform admin.
 * Must be used after authMiddleware.
 */
export const platformAdminMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const auth = c.get('auth')

  if (!auth) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  if (!auth.isPlatformAdmin) {
    return c.json({ error: 'Platform admin access required' }, 403)
  }

  await next()
})
