import { user, role, userRole, organization } from '../db/schema'
import { UserRole } from '@jet-erp/shared'
import { eq, and, count } from 'drizzle-orm'
import type { UserWithRoles } from '@jet-erp/shared'
import type { Database } from '../db'
import { generateUUID, now } from '../utils'

interface EntraUserInfo {
  objectId: string
  email: string
  displayName: string
  organizationId: string
}

export async function bootstrapUser(db: Database, entraUser: EntraUserInfo): Promise<UserWithRoles> {
  const { objectId, email, displayName, organizationId } = entraUser

  // Check if user already exists
  const existingUsers = await db
    .select()
    .from(user)
    .where(
      and(
        eq(user.organizationId, organizationId),
        eq(user.entraObjectId, objectId)
      )
    )

  if (existingUsers.length > 0) {
    // User exists, fetch their roles
    const existingUser = existingUsers[0]
    const userRoles = await getUserRoles(db, existingUser.id)
    return {
      ...existingUser,
      roles: userRoles,
      createdAt: existingUser.createdAt,
      updatedAt: existingUser.updatedAt,
    }
  }

  // New user - create them
  // Note: D1 doesn't support transactions, so there's a small race condition risk
  // for concurrent first-user logins. Acceptable for MVP.

  // Count existing users to determine if this is the first user
  const countResult = await db
    .select({ count: count() })
    .from(user)
    .where(eq(user.organizationId, organizationId))

  const existingUserCount = countResult[0]?.count || 0
  const isFirstUser = existingUserCount === 0

  const timestamp = now()
  const newUserId = generateUUID()

  // Create the user
  await db
    .insert(user)
    .values({
      id: newUserId,
      organizationId,
      entraObjectId: objectId,
      email,
      displayName,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

  // Fetch the created user (D1 doesn't support .returning() reliably)
  const [newUser] = await db
    .select()
    .from(user)
    .where(eq(user.id, newUserId))

  // Assign role based on whether this is the first user
  let assignedRoles: UserRole[] = []

  if (isFirstUser) {
    // First user in org - assign ADMIN role
    const adminRole = await db
      .select()
      .from(role)
      .where(eq(role.name, UserRole.ADMIN))

    if (adminRole.length > 0) {
      await db.insert(userRole).values({
        userId: newUser.id,
        roleId: adminRole[0].id,
      })
      assignedRoles = [UserRole.ADMIN]
      console.log(`First user in org ${organizationId}, assigned ADMIN role`)
    }
  } else {
    // Default role for subsequent users
    const reporterRole = await db
      .select()
      .from(role)
      .where(eq(role.name, UserRole.REPORTER))

    if (reporterRole.length > 0) {
      await db.insert(userRole).values({
        userId: newUser.id,
        roleId: reporterRole[0].id,
      })
      assignedRoles = [UserRole.REPORTER]
    }
  }

  return {
    ...newUser,
    roles: assignedRoles,
    createdAt: newUser.createdAt,
    updatedAt: newUser.updatedAt,
  }
}

export async function getUserRoles(db: Database, userId: string): Promise<UserRole[]> {
  const roles = await db
    .select({ name: role.name })
    .from(userRole)
    .innerJoin(role, eq(userRole.roleId, role.id))
    .where(eq(userRole.userId, userId))

  return roles.map(r => r.name as UserRole)
}

export async function assignRole(db: Database, userId: string, roleName: UserRole): Promise<void> {
  const roleRecord = await db
    .select()
    .from(role)
    .where(eq(role.name, roleName))

  if (roleRecord.length === 0) {
    throw new Error(`Role ${roleName} not found`)
  }

  // Check if already assigned
  const existing = await db
    .select()
    .from(userRole)
    .where(
      and(
        eq(userRole.userId, userId),
        eq(userRole.roleId, roleRecord[0].id)
      )
    )

  if (existing.length === 0) {
    await db.insert(userRole).values({
      userId,
      roleId: roleRecord[0].id,
    })
  }
}

export async function removeRole(db: Database, userId: string, roleName: UserRole): Promise<void> {
  const roleRecord = await db
    .select()
    .from(role)
    .where(eq(role.name, roleName))

  if (roleRecord.length === 0) {
    return
  }

  await db
    .delete(userRole)
    .where(
      and(
        eq(userRole.userId, userId),
        eq(userRole.roleId, roleRecord[0].id)
      )
    )
}

export async function getOrganizationByDomain(db: Database, domain: string): Promise<string | null> {
  const orgs = await db
    .select()
    .from(organization)
    .where(eq(organization.domain, domain))

  return orgs.length > 0 ? orgs[0].id : null
}
