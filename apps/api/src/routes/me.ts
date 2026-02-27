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

  // Single joined query: org modules + user roles for ALL orgs at once
  const orgIds = baseOrgs.map(o => o.id)
  const allModulesAndRoles = orgIds.length > 0
    ? await db
        .select({
          orgId: organizationModule.organizationId,
          moduleCode: module.code,
          moduleName: module.name,
          moduleIcon: module.icon,
          moduleId: module.id,
          userRole: userOrganizationModule.role,
        })
        .from(organizationModule)
        .innerJoin(module, and(
          eq(organizationModule.moduleId, module.id),
          eq(module.isActive, true)
        ))
        .leftJoin(userOrganizationModule, and(
          eq(userOrganizationModule.moduleId, module.id),
          eq(userOrganizationModule.organizationId, organizationModule.organizationId),
          eq(userOrganizationModule.userId, auth.userId),
          eq(userOrganizationModule.isActive, true)
        ))
        .where(and(
          ...(orgIds.length === 1
            ? [eq(organizationModule.organizationId, orgIds[0])]
            : []),
          eq(organizationModule.isActive, true)
        ))
    : []

  // Group results by org → module
  const orgModuleMap = new Map<string, Map<string, { code: string; name: string; icon: string | null; roles: string[] }>>()
  for (const row of allModulesAndRoles) {
    const orgId = row.orgId
    // Filter to only requested org IDs (needed when query doesn't filter by single orgId)
    if (orgIds.length > 1 && !orgIds.includes(orgId)) continue

    if (!orgModuleMap.has(orgId)) orgModuleMap.set(orgId, new Map())
    const moduleMap = orgModuleMap.get(orgId)!

    if (!moduleMap.has(row.moduleCode)) {
      moduleMap.set(row.moduleCode, {
        code: row.moduleCode,
        name: row.moduleName,
        icon: row.moduleIcon,
        roles: [],
      })
    }

    if (row.userRole) {
      moduleMap.get(row.moduleCode)!.roles.push(row.userRole)
    }
  }

  const orgsWithModules = baseOrgs.map(org => {
    const moduleMap = orgModuleMap.get(org.id)
    const modules = moduleMap
      ? [...moduleMap.values()].map(m => ({
          code: m.code,
          name: m.name,
          icon: m.icon,
          role: m.roles.length > 0 ? m.roles[0] : null,
          roles: m.roles,
        }))
      : []
    return { ...org, modules }
  })

  return c.json({ data: orgsWithModules })
})

// GET /me/modules - Get modules for current organization
meRoutes.get('/modules', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')

  // Single joined query: modules + user roles
  const orgModulesWithRoles = await db
    .select({
      id: module.id,
      code: module.code,
      name: module.name,
      description: module.description,
      icon: module.icon,
      userRole: userOrganizationModule.role,
    })
    .from(organizationModule)
    .innerJoin(module, and(
      eq(organizationModule.moduleId, module.id),
      eq(module.isActive, true)
    ))
    .leftJoin(userOrganizationModule, and(
      eq(userOrganizationModule.moduleId, module.id),
      eq(userOrganizationModule.organizationId, auth.organizationId),
      eq(userOrganizationModule.userId, auth.userId),
      eq(userOrganizationModule.isActive, true)
    ))
    .where(and(
      eq(organizationModule.organizationId, auth.organizationId),
      eq(organizationModule.isActive, true)
    ))

  // Group roles by module
  const moduleRoleMap = new Map<string, { id: string; code: string; name: string; description: string | null; icon: string | null; roles: string[] }>()
  for (const row of orgModulesWithRoles) {
    if (!moduleRoleMap.has(row.code)) {
      moduleRoleMap.set(row.code, {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        icon: row.icon,
        roles: [],
      })
    }
    if (row.userRole) {
      moduleRoleMap.get(row.code)!.roles.push(row.userRole)
    }
  }

  const modulesWithRoles = [...moduleRoleMap.values()].map(m => ({
    id: m.id,
    code: m.code,
    name: m.name,
    description: m.description,
    icon: m.icon,
    role: m.roles.length > 0 ? m.roles[0] : null,
    roles: m.roles,
  }))

  return c.json({ data: modulesWithRoles })
})

// GET /me/permissions - Get current user's permissions
// Accepts X-Module-Code header to get module-specific permissions
meRoutes.get('/permissions', async (c) => {
  const auth = c.get('auth') as AuthContext
  const db = c.get('db')

  // Prefer request header, then module context, then ERP as the default module
  const moduleCode = c.req.header('X-Module-Code') || auth.moduleCode || 'erp'

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
  const moduleCode = c.req.query('moduleCode') || auth.moduleCode || 'erp'

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
  if (moduleCode === 'erp') {
    return [
      { key: 'production', label: 'OEE Dashboard', path: '/erp/production', icon: 'Activity', visible: true, order: 0 },
      { key: 'sqft', label: 'Sq Ft Dashboard', path: '/erp/sqft', icon: 'Ruler', visible: true, order: 1 },
      { key: 'mrp', label: 'MRP & Inventory', path: '/erp/mrp', icon: 'Package', visible: true, order: 2 },
      { key: 'sales', label: 'Sales Dashboard', path: '/erp/sales', icon: 'TrendingUp', visible: true, order: 3 },
      { key: 'contribution', label: 'Contribution Dashboard', path: '/erp/contribution', icon: 'DollarSign', visible: true, order: 4 },
      { key: 'cost-variance', label: 'Cost Variance', path: '/erp/cost-variance', icon: 'ArrowLeftRight', visible: true, order: 5 },
      { key: 'quotes', label: 'Quotes', path: '/erp/quotes', icon: 'FileSpreadsheet', visible: true, order: 6 },
      { key: 'customers', label: 'Customers', path: '/erp/customers', icon: 'Factory', visible: true, order: 7 },
      { key: 'sql-explorer', label: 'SQL Explorer', path: '/erp/sql-explorer', icon: 'Terminal', visible: true, order: 8 },
      { key: 'users', label: 'User Management', path: '/erp/admin/users', icon: 'Users', visible: true, order: 9 },
    ]
  }
  if (moduleCode === 'qms') {
    return [
      { key: 'ncr', label: 'NCRs', path: '/qms/ncr', icon: 'AlertTriangle', visible: true, order: 0 },
      { key: 'rca', label: 'Root Cause Analysis', path: '/qms/rca', icon: 'Search', visible: true, order: 1 },
      { key: 'ca', label: 'Corrective Actions', path: '/qms/ca', icon: 'CheckCircle', visible: true, order: 2 },
      { key: 'iso-audits', label: 'ISO Audits', path: '/qms/iso-audits', icon: 'ClipboardCheck', visible: true, order: 3 },
      { key: 'audit-schedule', label: 'Audit Schedule', path: '/qms/audit-schedule', icon: 'Calendar', visible: true, order: 4 },
    ]
  }
  if (moduleCode === 'ci') {
    return [
      { key: 'ideas', label: 'Ideas', path: '/ci/ideas', icon: 'Lightbulb', visible: true, order: 0 },
      { key: 'projects', label: 'Projects', path: '/ci/projects', icon: 'ListTodo', visible: true, order: 1 },
      { key: 'actions', label: 'Action Plans', path: '/ci/actions', icon: 'CheckSquare', visible: true, order: 2 },
      { key: 'audits', label: 'Audits', path: '/ci/audits', icon: 'ClipboardCheck', visible: true, order: 3 },
      { key: 'walks', label: 'Gemba Walks', path: '/ci/walks', icon: 'Map', visible: true, order: 4 },
    ]
  }
  if (moduleCode === '5s') {
    return [
      { key: 'boards', label: '5S Boards', path: '/5s/boards', icon: 'LayoutGrid', visible: true, order: 0 },
      { key: 'audits', label: '5S Audits', path: '/5s/audits', icon: 'ClipboardCheck', visible: true, order: 1 },
      { key: 'actions', label: 'Action Plans', path: '/5s/actions', icon: 'CheckSquare', visible: true, order: 2 },
      { key: 'scores', label: 'Scorecards', path: '/5s/scorecards', icon: 'BarChart3', visible: true, order: 3 },
      { key: 'areas', label: 'Areas', path: '/5s/areas', icon: 'MapPin', visible: true, order: 4 },
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
