import { Hono } from 'hono'
import { UserRole } from '@jet-erp/shared'
import type { AuthContext } from '../types/auth'
import type { Env } from '../types/bindings'
import { eq, and } from 'drizzle-orm'
import { organization, organizationModule, module, userOrganizationModule, userNavPreferences } from '../db/schema'
import { generateUUID, now } from '../utils'

export const meRoutes = new Hono<{ Bindings: Env }>()

/**
 * Permission definitions based on design.md
 * Some permissions are role-based (static), others are contextual (owner, assigned, etc.)
 * This endpoint returns the static role-based permissions.
 * Contextual permissions are checked at the component/API level.
 */
interface Permissions {
  // NCR permissions
  'ncr.create': boolean
  'ncr.edit': boolean
  'ncr.delete': boolean
  'ncr.transition': boolean
  'ncr.assign': boolean
  'ncr.close': boolean
  // RCA permissions
  'rca.create': boolean
  'rca.edit': boolean
  'rca.approve': boolean
  // CA permissions
  'ca.create': boolean
  'ca.edit': boolean
  'ca.transition': boolean
  'ca.verify': boolean
  // Admin permissions
  'admin.users': boolean
  'admin.config': boolean
}

function derivePermissions(roles: UserRole[]): Permissions {
  const hasRole = (role: UserRole) => roles.includes(role)

  const isAdmin = hasRole(UserRole.ADMIN)
  const isQuality = hasRole(UserRole.QUALITY)
  const isApprover = hasRole(UserRole.APPROVER)
  const isProcessOwner = hasRole(UserRole.PROCESS_OWNER)
  const isReporter = hasRole(UserRole.REPORTER)

  return {
    // NCR permissions
    // Create NCR: REPORTER, QUALITY, PROCESS_OWNER, ADMIN
    'ncr.create': isReporter || isQuality || isProcessOwner || isAdmin,
    // Edit NCR: QUALITY, ADMIN (contextual: creator, assigned_to also can edit)
    'ncr.edit': isQuality || isAdmin,
    // Delete NCR: ADMIN (contextual: creator within 24h)
    'ncr.delete': isAdmin,
    // Transition NCR: QUALITY, PROCESS_OWNER, ADMIN
    'ncr.transition': isQuality || isProcessOwner || isAdmin,
    // Assign NCR: QUALITY, ADMIN
    'ncr.assign': isQuality || isAdmin,
    // Close NCR: QUALITY, APPROVER, ADMIN
    'ncr.close': isQuality || isApprover || isAdmin,

    // RCA permissions
    // Create RCA: QUALITY, ADMIN (contextual: assigned NCR owner)
    'rca.create': isQuality || isAdmin,
    // Edit RCA: QUALITY, ADMIN (contextual: owner)
    'rca.edit': isQuality || isAdmin,
    // Approve RCA: APPROVER, QUALITY, ADMIN (cannot be owner - checked contextually)
    'rca.approve': isApprover || isQuality || isAdmin,

    // CA permissions
    // Create CA: QUALITY, ADMIN (contextual: RCA owner, assigned NCR owner)
    'ca.create': isQuality || isAdmin,
    // Edit CA: QUALITY, ADMIN (contextual: accountable_user)
    'ca.edit': isQuality || isAdmin,
    // Transition CA: QUALITY, ADMIN (contextual: accountable_user)
    'ca.transition': isQuality || isAdmin,
    // Verify CA: QUALITY, PROCESS_OWNER, ADMIN (cannot be accountable - checked contextually)
    'ca.verify': isQuality || isProcessOwner || isAdmin,

    // Admin permissions
    'admin.users': isAdmin,
    'admin.config': isAdmin,
  }
}

// GET /me - Get current user info
meRoutes.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext

  return c.json({
    data: {
      id: auth.userId,
      organizationId: auth.organizationId,
      email: auth.email,
      displayName: auth.displayName,
      roles: auth.roles,
      organizations: auth.organizations,
      isPlatformAdmin: auth.isPlatformAdmin ?? false,
    }
  })
})

// GET /me/organizations - Get detailed info about user's organizations
// Platform admins see ALL organizations, regular users see only their memberships
meRoutes.get('/organizations', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')

  // Platform admins get ALL active organizations
  let baseOrgs = auth.organizations
  if (auth.isPlatformAdmin) {
    const allOrgs = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      })
      .from(organization)
      .where(eq(organization.isActive, true))

    // Mark user's own orgs as default, others not
    const userOrgIds = new Set(auth.organizations.map(o => o.id))
    baseOrgs = allOrgs.map(org => ({
      ...org,
      isDefault: auth.organizations.find(o => o.id === org.id)?.isDefault ?? false,
      isMember: userOrgIds.has(org.id),
    }))
  }

  // For each org, get the modules and user's role in each module
  const orgsWithModules = await Promise.all(
    baseOrgs.map(async (org) => {
      // Get modules enabled for this org
      const orgModules = await db
        .select({
          moduleId: module.id,
          moduleCode: module.code,
          moduleName: module.name,
          moduleIcon: module.icon,
        })
        .from(organizationModule)
        .innerJoin(module, eq(organizationModule.moduleId, module.id))
        .where(and(
          eq(organizationModule.organizationId, org.id),
          eq(organizationModule.isActive, true),
          eq(module.isActive, true)
        ))

      // Get user's roles in each module
      const modulesWithRoles = await Promise.all(
        orgModules.map(async (m) => {
          const userMod = await db
            .select({ role: userOrganizationModule.role })
            .from(userOrganizationModule)
            .where(and(
              eq(userOrganizationModule.userId, auth.userId),
              eq(userOrganizationModule.organizationId, org.id),
              eq(userOrganizationModule.moduleId, m.moduleId),
              eq(userOrganizationModule.isActive, true)
            ))

          return {
            code: m.moduleCode,
            name: m.moduleName,
            icon: m.moduleIcon,
            role: userMod.length > 0 ? userMod[0].role : null,
            roles: userMod.map(um => um.role),
          }
        })
      )

      return {
        ...org,
        modules: modulesWithRoles,
      }
    })
  )

  return c.json({ data: orgsWithModules })
})

// GET /me/modules - Get modules for current organization
meRoutes.get('/modules', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')

  // Get modules enabled for current org
  const orgModules = await db
    .select({
      id: module.id,
      code: module.code,
      name: module.name,
      description: module.description,
      icon: module.icon,
    })
    .from(organizationModule)
    .innerJoin(module, eq(organizationModule.moduleId, module.id))
    .where(and(
      eq(organizationModule.organizationId, auth.organizationId),
      eq(organizationModule.isActive, true),
      eq(module.isActive, true)
    ))

  // Get user's role in each module
  const modulesWithRoles = await Promise.all(
    orgModules.map(async (m) => {
      const userMod = await db
        .select({ role: userOrganizationModule.role })
        .from(userOrganizationModule)
        .where(and(
          eq(userOrganizationModule.userId, auth.userId),
          eq(userOrganizationModule.organizationId, auth.organizationId),
          eq(userOrganizationModule.moduleId, m.id),
          eq(userOrganizationModule.isActive, true)
        ))

      return {
        ...m,
        role: userMod.length > 0 ? userMod[0].role : null,
        roles: userMod.map(um => um.role),
      }
    })
  )

  return c.json({ data: modulesWithRoles })
})

// GET /me/permissions - Get current user's permissions
// Accepts X-Module-Code header to get module-specific permissions
meRoutes.get('/permissions', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')

  // Get module code from header, default to 'qms' for backward compat
  const moduleCode = c.req.header('X-Module-Code') || 'qms'

  // If module context is already set (from module middleware), use those roles
  if (auth.moduleRoles && auth.moduleRoles.length > 0) {
    const permissions = derivePermissions(auth.moduleRoles as UserRole[])
    return c.json({
      data: {
        moduleCode: auth.moduleCode,
        role: auth.moduleRoles[0],
        roles: auth.moduleRoles,
        permissions,
      }
    })
  }
  if (auth.moduleRole) {
    const permissions = derivePermissions([auth.moduleRole as UserRole])
    return c.json({
      data: {
        moduleCode: auth.moduleCode,
        role: auth.moduleRole,
        roles: [auth.moduleRole],
        permissions,
      }
    })
  }

  // Otherwise, look up the module and user's role
  const modules = await db
    .select()
    .from(module)
    .where(eq(module.code, moduleCode))

  if (modules.length === 0) {
    // Module not found, fall back to auth.roles
    const permissions = derivePermissions(auth.roles)
    return c.json({
      data: {
        moduleCode,
        role: auth.roles[0] || null,
        roles: auth.roles,
        permissions,
      }
    })
  }

  const userMod = await db
    .select({ role: userOrganizationModule.role })
    .from(userOrganizationModule)
    .where(and(
      eq(userOrganizationModule.userId, auth.userId),
      eq(userOrganizationModule.organizationId, auth.organizationId),
      eq(userOrganizationModule.moduleId, modules[0].id),
      eq(userOrganizationModule.isActive, true)
    ))

  const moduleRoles = userMod.map(um => um.role)
  const effectiveRoles = moduleRoles.length > 0 ? (moduleRoles as UserRole[]) : auth.roles
  const permissions = derivePermissions(effectiveRoles)

  return c.json({
    data: {
      moduleCode,
      role: moduleRoles[0] ?? null,
      roles: effectiveRoles,
      permissions,
    }
  })
})

// GET /me/nav-preferences - Get user's nav preferences for a module
meRoutes.get('/nav-preferences', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')
  const moduleCode = c.req.query('moduleCode') || 'qms'

  const prefs = await db
    .select()
    .from(userNavPreferences)
    .where(and(
      eq(userNavPreferences.userId, auth.userId),
      eq(userNavPreferences.organizationId, auth.organizationId),
      eq(userNavPreferences.moduleCode, moduleCode)
    ))

  if (prefs.length === 0) {
    // Return default nav items for module
    return c.json({ data: { moduleCode, navItems: getDefaultNavItems(moduleCode) } })
  }

  return c.json({
    data: {
      moduleCode,
      navItems: JSON.parse(prefs[0].navItems),
    }
  })
})

// PUT /me/nav-preferences - Save user's nav preferences
meRoutes.put('/nav-preferences', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')
  const body = await c.req.json<{ moduleCode: string; navItems: any[] }>()

  const { moduleCode, navItems } = body

  if (!moduleCode || !navItems || !Array.isArray(navItems)) {
    return c.json({ error: 'Invalid request body' }, 400)
  }

  // Check if preference exists
  const existing = await db
    .select()
    .from(userNavPreferences)
    .where(and(
      eq(userNavPreferences.userId, auth.userId),
      eq(userNavPreferences.organizationId, auth.organizationId),
      eq(userNavPreferences.moduleCode, moduleCode)
    ))

  const timestamp = now()

  if (existing.length > 0) {
    // Update
    await db
      .update(userNavPreferences)
      .set({
        navItems: JSON.stringify(navItems),
        updatedAt: timestamp,
      })
      .where(eq(userNavPreferences.id, existing[0].id))
  } else {
    // Insert
    await db
      .insert(userNavPreferences)
      .values({
        id: generateUUID(),
        userId: auth.userId,
        organizationId: auth.organizationId,
        moduleCode,
        navItems: JSON.stringify(navItems),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
  }

  return c.json({ success: true })
})

// Helper: Default nav items for each module
function getDefaultNavItems(moduleCode: string): any[] {
  if (moduleCode === 'qms') {
    return [
      { key: 'ncr', label: 'NCRs', path: '/qms/ncr', icon: 'AlertTriangle', visible: true, order: 0 },
      { key: 'rca', label: 'Root Cause Analysis', path: '/qms/rca', icon: 'Search', visible: true, order: 1 },
      { key: 'ca', label: 'Corrective Actions', path: '/qms/ca', icon: 'CheckCircle', visible: true, order: 2 },
      { key: 'iso-audits', label: 'ISO Audits', path: '/qms/iso-audits', icon: 'ClipboardCheck', visible: true, order: 3 },
      { key: 'audit-schedule', label: 'Audit Schedule', path: '/qms/audit-schedule', icon: 'Calendar', visible: true, order: 4 },
    ]
  }
  if (moduleCode === 'maintenance') {
    return [
      { key: 'work-orders', label: 'Work Orders', path: '/maintenance/work-orders', icon: 'Clipboard', visible: true, order: 0 },
      { key: 'pm-schedules', label: 'PM Schedules', path: '/maintenance/pm-schedules', icon: 'Calendar', visible: true, order: 1 },
      { key: 'assets', label: 'Assets', path: '/maintenance/assets', icon: 'HardDrive', visible: true, order: 2 },
      { key: 'parts', label: 'Parts & Inventory', path: '/maintenance/parts', icon: 'Package', visible: true, order: 3 },
    ]
  }
  return []
}
