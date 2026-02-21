import { createMiddleware } from 'hono/factory'
import type { AuthContext, DevUserConfig, UserOrg } from '../types/auth'
import type { Env } from '../types/bindings'
import type { Database } from '../db'
import { UserRole } from '@jet-erp/shared'
import { validateEntraToken } from '../services/jwt'
import { bootstrapUser, getUserRoles } from '../services/user-bootstrap'
import { user, organization, userOrganization, userOrganizationModule } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { hasAnyScopedRole, hasScopedRole } from './role-scope'
import '../types/auth'

// Single-tenant: All users belong to this organization
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'
export const QMS_MODULE_ID = '00000000-0000-0000-0000-000000000010'

// Default dev user for local development
const DEFAULT_DEV_USER: DevUserConfig = {
  userId: '00000000-0000-0000-0000-000000000001',
  organizationId: DEFAULT_ORG_ID,
  email: 'dev@localhost',
  displayName: 'Dev User',
  roles: [UserRole.ADMIN],
  organizations: [{
    id: DEFAULT_ORG_ID,
    name: 'My Organization',
    slug: 'default',
    isDefault: true,
  }],
}

/**
 * Get user's organizations from the user_organization table
 * Falls back to user.organizationId for backward compat during migration
 */
async function getUserOrganizations(db: Database, userId: string, fallbackOrgId?: string): Promise<UserOrg[]> {
  // Query user_organization with organization join
  const memberships = await db
    .select({
      orgId: organization.id,
      orgName: organization.name,
      orgSlug: organization.slug,
      isDefault: userOrganization.isDefault,
    })
    .from(userOrganization)
    .innerJoin(organization, eq(userOrganization.organizationId, organization.id))
    .where(and(
      eq(userOrganization.userId, userId),
      eq(userOrganization.isActive, true)
    ))

  if (memberships.length > 0) {
    return memberships.map(m => ({
      id: m.orgId,
      name: m.orgName,
      slug: m.orgSlug,
      isDefault: m.isDefault ?? false,
    }))
  }

  // Backward compat: No memberships yet, use old user.organizationId
  if (fallbackOrgId) {
    const orgs = await db
      .select()
      .from(organization)
      .where(eq(organization.id, fallbackOrgId))

    if (orgs.length > 0) {
      return [{
        id: orgs[0].id,
        name: orgs[0].name,
        slug: orgs[0].slug,
        isDefault: true,
      }]
    }
  }

  return []
}

/**
 * Resolve which organization to use for the current request
 * Priority: X-Organization-Id header > default org > first org
 * Platform admins can access any organization
 */
function resolveCurrentOrg(
  orgs: UserOrg[],
  headerOrgId: string | undefined,
  isPlatformAdmin: boolean = false
): { orgId: string; error?: string } {
  if (orgs.length === 0) {
    if (headerOrgId && isPlatformAdmin) {
      return { orgId: headerOrgId }
    }
    return { orgId: '', error: 'No organization access' }
  }

  // If header provided, validate user has access (or is platform admin)
  if (headerOrgId) {
    const found = orgs.find(o => o.id === headerOrgId)
    if (!found && !isPlatformAdmin) {
      return { orgId: '', error: 'Access denied to organization' }
    }
    // Platform admin can access any org
    return { orgId: headerOrgId }
  }

  // No header: use default org if exists, else first org
  const defaultOrg = orgs.find(o => o.isDefault)
  return { orgId: defaultOrg?.id ?? orgs[0].id }
}

/**
 * Get user's roles for the current org from user_organization_module
 * Falls back to old getUserRoles for backward compat
 */
export async function getUserOrgRoles(db: Database, userId: string, organizationId: string): Promise<UserRole[]> {
  // Try new user_organization_module table first
  const moduleRoles = await db
    .select({ role: userOrganizationModule.role })
    .from(userOrganizationModule)
    .where(and(
      eq(userOrganizationModule.userId, userId),
      eq(userOrganizationModule.organizationId, organizationId),
      eq(userOrganizationModule.isActive, true)
    ))

  if (moduleRoles.length > 0) {
    // Dedupe roles across modules
    const roles = [...new Set(moduleRoles.map(r => r.role as UserRole))]
    return roles
  }

  // Backward compat: Fall back to old user_role table
  return getUserRoles(db, userId)
}

// Parse dev user from header or env
function getDevUser(_env: Env): DevUserConfig {
  // In Workers, we can store config in environment variables
  // This could be enhanced to read from KV if needed
  return DEFAULT_DEV_USER
}

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const db = c.get('db')
  const kv = c.get('kv')

  // Read X-Organization-Id header for multi-org support
  const orgHeader = c.req.header('X-Organization-Id')

  // Check for X-Dev-User header only when explicitly allowed in development
  // Requires BOTH flags to be explicitly set - fails closed if either is missing
  const allowDevAuth = c.env.ALLOW_DEV_AUTH === 'true' && c.env.ENVIRONMENT === 'development'
  if (allowDevAuth) {
    const devUserHeader = c.req.header('X-Dev-User')
    if (devUserHeader) {
      try {
        const headerConfig = JSON.parse(devUserHeader) as Partial<DevUserConfig>
        const devUser = { ...getDevUser(c.env), ...headerConfig }
        // If header provides organizationId but not organizations, rebuild organizations
        // to use the header's organizationId (not DEFAULT_DEV_USER's)
        const organizations = headerConfig.organizations ?? (headerConfig.organizationId ? [{
          id: headerConfig.organizationId,
          name: 'My Organization',
          slug: 'default',
          isDefault: true,
        }] : devUser.organizations ?? [{
          id: devUser.organizationId,
          name: 'My Organization',
          slug: 'default',
          isDefault: true,
        }])
        // Respect isPlatformAdmin from header if provided, otherwise default to true
        const isPlatformAdmin = headerConfig.isPlatformAdmin ?? true
        const { orgId, error: orgError } = resolveCurrentOrg(organizations, orgHeader, isPlatformAdmin)
        if (orgError) {
          return c.json({ error: orgError }, 403)
        }
        const authContext: AuthContext = {
          userId: devUser.userId,
          organizationId: orgId,
          email: devUser.email,
          displayName: devUser.displayName,
          organizations,
          isPlatformAdmin,
          isDevRoleOverride: true,
          roles: devUser.roles,
        }
        c.set('auth', authContext)
        return next()
      } catch {
        // Fall through to JWT validation
      }
    }
  }

  // Bearer token validation (session token or JWT)
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)

    // First, try session-based auth (our tokens are 64 hex chars)
    if (token.length === 64 && /^[a-f0-9]+$/i.test(token)) {
      const { validateSession } = await import('../services/auth')
      const session = await validateSession(db, token)

      if (session) {
        // Session is valid, get user info
        const userResult = await db
          .select()
          .from(user)
          .where(eq(user.id, session.userId))

        if (userResult.length > 0) {
          const foundUser = userResult[0]

          if (!foundUser.isActive) {
            return c.json({ error: 'Account deactivated' }, 403)
          }

          // Get user's organizations (with backward compat)
          const organizations = await getUserOrganizations(db, foundUser.id, foundUser.organizationId)

          // Resolve current org from header or auto-select
          const isPlatformAdmin = foundUser.isPlatformAdmin ?? false
          const { orgId, error: orgError } = resolveCurrentOrg(organizations, orgHeader, isPlatformAdmin)
          if (orgError) {
            return c.json({ error: orgError }, 403)
          }

          // Get roles for current org
          const roles = await getUserOrgRoles(db, foundUser.id, orgId)

          const authContext: AuthContext = {
            userId: foundUser.id,
            organizationId: orgId,
            email: foundUser.email,
            displayName: foundUser.displayName,
            organizations,
            isPlatformAdmin,
            roles,
          }

          c.set('auth', authContext)
          return next()
        }
      }
    }

    // Fall back to JWT validation (Entra tokens)
    // Validate audience is configured
    const audience = c.env.AZURE_CLIENT_ID || c.env.AZURE_AD_CLIENT_ID
    if (!audience) {
      // If no Azure AD configured, and session auth failed, return unauthorized
      return c.json({ error: 'Unauthorized', message: 'Invalid session' }, 401)
    }

    // Validate the JWT using KV for JWKS caching
    const result = await validateEntraToken(token, audience, kv)

    if (!result.valid || !result.claims) {
      return c.json({ error: 'Unauthorized', message: result.error }, 401)
    }

    const { claims } = result

    // Look up user by Entra Object ID (globally)
    // First try by entraObjectId alone (new global identity)
    let existingUser = await db
      .select()
      .from(user)
      .where(eq(user.entraObjectId, claims.oid))

    // Backward compat: Also try with org filter if not found
    if (existingUser.length === 0) {
      existingUser = await db
        .select()
        .from(user)
        .where(
          and(
            eq(user.organizationId, DEFAULT_ORG_ID),
            eq(user.entraObjectId, claims.oid)
          )
        )
    }

    let userId: string
    let roles: UserRole[]
    let organizations: UserOrg[]

    if (existingUser.length === 0) {
      // Bootstrap new user into the default org
      const bootstrapped = await bootstrapUser(db, {
        objectId: claims.oid,
        email: claims.email || claims.preferred_username || 'unknown@unknown.com',
        displayName: claims.name || 'Unknown User',
        organizationId: DEFAULT_ORG_ID,
      })
      userId = bootstrapped.id
      roles = bootstrapped.roles
      // New users get the default org
      organizations = [{
        id: DEFAULT_ORG_ID,
        name: 'My Organization',
        slug: 'default',
        isDefault: true,
      }]
    } else {
      if (existingUser[0].deletedAt || !existingUser[0].isActive) {
        return c.json({ error: 'Account deactivated' }, 403)
      }
      userId = existingUser[0].id

      // Get user's organizations
      organizations = await getUserOrganizations(db, userId, existingUser[0].organizationId)
    }

    // Get isPlatformAdmin for existing users (before resolving org so admins can access any org)
    const isPlatformAdmin = existingUser.length > 0 ? (existingUser[0].isPlatformAdmin ?? false) : false

    // Resolve current org from header or auto-select
    const { orgId, error: orgError } = resolveCurrentOrg(organizations, orgHeader, isPlatformAdmin)
    if (orgError) {
      return c.json({ error: orgError }, 403)
    }

    // Get roles for current org
    roles = await getUserOrgRoles(db, userId, orgId)

    // Map Entra app roles to our roles if present
    if (claims.roles && claims.roles.length > 0) {
      // Entra roles take precedence if configured
      const mappedRoles = claims.roles
        .map(r => mapEntraRole(r))
        .filter((r): r is UserRole => r !== null)

      if (mappedRoles.length > 0) {
        roles = mappedRoles
      }
    }

    const authContext: AuthContext = {
      userId,
      organizationId: orgId,
      email: claims.email || claims.preferred_username || '',
      displayName: claims.name || '',
      organizations,
      isPlatformAdmin,
      roles,
    }

    c.set('auth', authContext)
    return next()
  }

  // Dev mode fallback (no auth header, no X-Dev-User) - only when explicitly allowed
  if (allowDevAuth) {
    const devUser = getDevUser(c.env)
    const organizations = devUser.organizations ?? [{
      id: devUser.organizationId,
      name: 'My Organization',
      slug: 'default',
      isDefault: true,
    }]
    const { orgId, error: orgError } = resolveCurrentOrg(organizations, orgHeader, true) // Dev user is platform admin
    if (orgError) {
      return c.json({ error: orgError }, 403)
    }
    const authContext: AuthContext = {
      userId: devUser.userId,
      organizationId: orgId,
      email: devUser.email,
      displayName: devUser.displayName,
      organizations,
      isPlatformAdmin: true, // Dev user is always platform admin
      isDevRoleOverride: true,
      roles: devUser.roles,
    }
    c.set('auth', authContext)
    return next()
  }

  // No valid auth
  return c.json({ error: 'Unauthorized' }, 401)
})

/**
 * Map Entra app role to internal UserRole
 */
function mapEntraRole(entraRole: string): UserRole | null {
  const mapping: Record<string, UserRole> = {
    'Admin': UserRole.ADMIN,
    'Quality': UserRole.QUALITY,
    'Approver': UserRole.APPROVER,
    'ProcessOwner': UserRole.PROCESS_OWNER,
    'Reporter': UserRole.REPORTER,
    // Also handle lowercase
    'admin': UserRole.ADMIN,
    'quality': UserRole.QUALITY,
    'approver': UserRole.APPROVER,
    'processowner': UserRole.PROCESS_OWNER,
    'process_owner': UserRole.PROCESS_OWNER,
    'reporter': UserRole.REPORTER,
  }
  return mapping[entraRole] || null
}

// Helper to get auth context from request
export function getAuth(c: { get: (key: 'auth') => AuthContext }): AuthContext {
  return c.get('auth')
}

// Helper to check if user has role
export function hasRole(auth: AuthContext, role: UserRole): boolean {
  return hasScopedRole(auth, role)
}

// Helper to check if user has any of the specified roles
export function hasAnyRole(auth: AuthContext, roles: UserRole[]): boolean {
  return hasAnyScopedRole(auth, roles)
}
