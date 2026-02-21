import { createMiddleware } from 'hono/factory'
import type { Env } from '../types/bindings'
import { module, organizationModule, userOrganizationModule } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import '../types/auth'

/**
 * Middleware factory that validates module access and sets module context
 * Use this for module-specific routes (e.g., /qms/*)
 */
export function moduleContextMiddleware(moduleCode: string) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const auth = c.get('auth')
    const db = c.get('db')

    // Look up module by code
    const modules = await db
      .select()
      .from(module)
      .where(eq(module.code, moduleCode))

    const mod = modules[0]
    if (!mod) {
      return c.json({ error: `Unknown module: ${moduleCode}` }, 404)
    }

    if (!mod.isActive) {
      return c.json({ error: `Module ${moduleCode} is not active` }, 403)
    }

    // Verify org has module enabled
    const orgMods = await db
      .select()
      .from(organizationModule)
      .where(and(
        eq(organizationModule.organizationId, auth.organizationId),
        eq(organizationModule.moduleId, mod.id),
        eq(organizationModule.isActive, true)
      ))

    if (orgMods.length === 0) {
      return c.json({ error: 'Module not enabled for organization' }, 403)
    }

    // Get user's role in this module
    const userMods = await db
      .select()
      .from(userOrganizationModule)
      .where(and(
        eq(userOrganizationModule.userId, auth.userId),
        eq(userOrganizationModule.organizationId, auth.organizationId),
        eq(userOrganizationModule.moduleId, mod.id),
        eq(userOrganizationModule.isActive, true)
      ))

    if (userMods.length === 0) {
      return c.json({ error: 'No access to module' }, 403)
    }

    // Update auth context with module-scoped role
    c.set('auth', {
      ...auth,
      moduleId: mod.id,
      moduleCode: mod.code,
      moduleRole: userMods[0].role,
    })

    return next()
  })
}
