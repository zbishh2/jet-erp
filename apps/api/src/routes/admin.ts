import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types/bindings'
import type { AuthContext } from '../types/auth'
import { user, userOrganization, userOrganizationModule } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { createInvite, getOrgInvites, deleteInvite } from '../services/auth'
import { sendEmail } from '../services/email'
import { organization } from '../db/schema'
import { logAudit } from '../services/audit'
import { getScopedRoles } from '../middleware/role-scope'

function isAdmin(auth: AuthContext): boolean {
  const roles = getScopedRoles(auth)
  return roles.includes('ADMIN')
}

export const adminRoutes = new Hono<{ Bindings: Env }>()

// All admin routes require ADMIN role
adminRoutes.use('*', async (c, next) => {
  const auth = c.get('auth')
  if (!isAdmin(auth)) {
    return c.json({ error: 'Forbidden', message: 'Requires ADMIN role' }, 403)
  }
  return next()
})

// GET /users — list org users with roles
adminRoutes.get('/users', async (c) => {
  const auth = c.get('auth')
  const db = c.get('db')

  // Get all users in the org via userOrganization
  const memberships = await db
    .select({
      userId: userOrganization.userId,
      isActive: userOrganization.isActive,
    })
    .from(userOrganization)
    .where(eq(userOrganization.organizationId, auth.organizationId))

  if (memberships.length === 0) {
    return c.json({ users: [] })
  }

  const userIds = memberships.map(m => m.userId)

  // Get user details
  const users = await db
    .select({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: user.isActive,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.organizationId, auth.organizationId))

  // Get module roles for all users in this org
  const moduleRoles = await db
    .select({
      userId: userOrganizationModule.userId,
      role: userOrganizationModule.role,
    })
    .from(userOrganizationModule)
    .where(
      and(
        eq(userOrganizationModule.organizationId, auth.organizationId),
        eq(userOrganizationModule.isActive, true)
      )
    )

  // Build role map
  const roleMap = new Map<string, string[]>()
  for (const mr of moduleRoles) {
    const existing = roleMap.get(mr.userId) ?? []
    if (!existing.includes(mr.role)) {
      existing.push(mr.role)
    }
    roleMap.set(mr.userId, existing)
  }

  const memberUserIds = new Set(userIds)
  const result = users
    .filter(u => memberUserIds.has(u.id))
    .map(u => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isActive: u.isActive,
      createdAt: u.createdAt,
      roles: roleMap.get(u.id) ?? [],
    }))

  return c.json({ users: result })
})

// GET /invites — list pending invites
adminRoutes.get('/invites', async (c) => {
  const auth = c.get('auth')
  const db = c.get('db')

  const invites = await getOrgInvites(db, auth.organizationId)
  return c.json({ invites })
})

// POST /invites — create invite
const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['ADMIN', 'FINANCE', 'ESTIMATOR', 'VIEWER']),
})

adminRoutes.post('/invites', async (c) => {
  const auth = c.get('auth')
  const db = c.get('db')

  const body = await c.req.json()
  const parsed = createInviteSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { email, role } = parsed.data

  const token = await createInvite(db, auth.organizationId, email, role, auth.userId)

  // Derive base URL from Origin or Referer header
  const origin = c.req.header('Origin') || c.req.header('Referer')?.replace(/\/[^/]*$/, '') || ''
  const signupUrl = `${origin}/signup?invite=${token}`

  // Send invite email
  const org = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, auth.organizationId))
    .limit(1)

  const orgName = org[0]?.name ?? 'Jet Container'

  await sendEmail(c.env.RESEND_API_KEY, {
    to: email,
    subject: `You've been invited to join ${orgName}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1f2937;">You're Invited!</h2>
        <p style="color: #4b5563;">
          ${auth.displayName} has invited you to join <strong>${orgName}</strong>.
        </p>
        <div style="margin: 24px 0;">
          <a href="${signupUrl}"
             style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This invitation expires in 7 days.</p>
        <p style="color: #6b7280; font-size: 14px;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    `,
  })

  await logAudit(c, { action: 'invite.create', resource: 'invite', metadata: { email, role } })

  return c.json({ token, signupUrl, email, role }, 201)
})

// PUT /users/:id/roles — update a user's roles (full set replacement)
const updateRolesSchema = z.object({
  roles: z.array(z.enum(['ADMIN', 'FINANCE', 'ESTIMATOR', 'VIEWER'])),
})

adminRoutes.put('/users/:id/roles', async (c) => {
  const auth = c.get('auth')
  const db = c.get('db')
  const userId = c.req.param('id')

  const body = await c.req.json()
  const parsed = updateRolesSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { roles: desiredRoles } = parsed.data

  // Verify user belongs to this org
  const membership = await db
    .select({ userId: userOrganization.userId })
    .from(userOrganization)
    .where(
      and(
        eq(userOrganization.userId, userId),
        eq(userOrganization.organizationId, auth.organizationId),
        eq(userOrganization.isActive, true)
      )
    )
    .limit(1)

  if (membership.length === 0) {
    return c.json({ error: 'User not found in your organization' }, 404)
  }

  // Get the ERP module
  const { module } = await import('../db/schema')
  const erpModule = await db
    .select({ id: module.id })
    .from(module)
    .where(eq(module.code, 'erp'))
    .limit(1)

  if (erpModule.length === 0) {
    return c.json({ error: 'ERP module not found' }, 500)
  }

  const moduleId = erpModule[0].id
  const timestamp = new Date().toISOString()

  // Get current active roles
  const currentRows = await db
    .select({ id: userOrganizationModule.id, role: userOrganizationModule.role })
    .from(userOrganizationModule)
    .where(
      and(
        eq(userOrganizationModule.userId, userId),
        eq(userOrganizationModule.organizationId, auth.organizationId),
        eq(userOrganizationModule.moduleId, moduleId),
        eq(userOrganizationModule.isActive, true)
      )
    )

  const currentRoles = currentRows.map(r => r.role)
  const toAdd = desiredRoles.filter(r => !currentRoles.includes(r))
  const toRemove = currentRows.filter(r => !(desiredRoles as string[]).includes(r.role))

  // Deactivate removed roles
  for (const row of toRemove) {
    await db
      .update(userOrganizationModule)
      .set({ isActive: false, updatedAt: timestamp })
      .where(eq(userOrganizationModule.id, row.id))
  }

  // Add new roles
  for (const role of toAdd) {
    // Check if an inactive row exists for this role (reactivate it)
    const inactive = await db
      .select({ id: userOrganizationModule.id })
      .from(userOrganizationModule)
      .where(
        and(
          eq(userOrganizationModule.userId, userId),
          eq(userOrganizationModule.organizationId, auth.organizationId),
          eq(userOrganizationModule.moduleId, moduleId),
          eq(userOrganizationModule.role, role),
          eq(userOrganizationModule.isActive, false)
        )
      )
      .limit(1)

    if (inactive.length > 0) {
      await db
        .update(userOrganizationModule)
        .set({ isActive: true, updatedAt: timestamp })
        .where(eq(userOrganizationModule.id, inactive[0].id))
    } else {
      await db.insert(userOrganizationModule).values({
        id: crypto.randomUUID(),
        userId,
        organizationId: auth.organizationId,
        moduleId,
        role,
        isActive: true,
        grantedAt: timestamp,
        grantedByUserId: auth.userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }
  }

  await logAudit(c, {
    action: 'user.roles_update',
    resource: 'user',
    resourceId: userId,
    metadata: { desiredRoles, previousRoles: currentRoles },
  })

  return c.json({ success: true })
})

// Keep backward-compat single role endpoint
const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'FINANCE', 'ESTIMATOR', 'VIEWER', '']),
})

adminRoutes.put('/users/:id/role', async (c) => {
  const auth = c.get('auth')
  const db = c.get('db')
  const userId = c.req.param('id')

  const body = await c.req.json()
  const parsed = updateRoleSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400)
  }

  const { role: newRole } = parsed.data

  // Verify user belongs to this org
  const membership = await db
    .select({ userId: userOrganization.userId })
    .from(userOrganization)
    .where(
      and(
        eq(userOrganization.userId, userId),
        eq(userOrganization.organizationId, auth.organizationId),
        eq(userOrganization.isActive, true)
      )
    )
    .limit(1)

  if (membership.length === 0) {
    return c.json({ error: 'User not found in your organization' }, 404)
  }

  // Get the ERP module
  const { module } = await import('../db/schema')
  const erpModule = await db
    .select({ id: module.id })
    .from(module)
    .where(eq(module.code, 'erp'))
    .limit(1)

  if (erpModule.length === 0) {
    return c.json({ error: 'ERP module not found' }, 500)
  }

  const moduleId = erpModule[0].id
  const timestamp = new Date().toISOString()

  // Find existing module roles
  const existing = await db
    .select({ id: userOrganizationModule.id })
    .from(userOrganizationModule)
    .where(
      and(
        eq(userOrganizationModule.userId, userId),
        eq(userOrganizationModule.organizationId, auth.organizationId),
        eq(userOrganizationModule.moduleId, moduleId),
        eq(userOrganizationModule.isActive, true)
      )
    )

  if (newRole === '') {
    // Remove all roles
    for (const row of existing) {
      await db
        .update(userOrganizationModule)
        .set({ isActive: false, updatedAt: timestamp })
        .where(eq(userOrganizationModule.id, row.id))
    }
  } else {
    // Deactivate all existing, then add the single role
    for (const row of existing) {
      await db
        .update(userOrganizationModule)
        .set({ isActive: false, updatedAt: timestamp })
        .where(eq(userOrganizationModule.id, row.id))
    }
    await db.insert(userOrganizationModule).values({
      id: crypto.randomUUID(),
      userId,
      organizationId: auth.organizationId,
      moduleId,
      role: newRole,
      isActive: true,
      grantedAt: timestamp,
      grantedByUserId: auth.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  await logAudit(c, {
    action: 'user.role_update',
    resource: 'user',
    resourceId: userId,
    metadata: { newRole: newRole || 'none' },
  })

  return c.json({ success: true })
})

// DELETE /invites/:id — delete invite
adminRoutes.delete('/invites/:id', async (c) => {
  const auth = c.get('auth')
  const db = c.get('db')
  const inviteId = c.req.param('id')

  await deleteInvite(db, inviteId, auth.organizationId)

  await logAudit(c, { action: 'invite.delete', resource: 'invite', resourceId: inviteId })

  return c.json({ success: true })
})
