import { eq, and, gt, isNull } from 'drizzle-orm'
import { user, organization, session, emailVerification, orgInvite, role, userRole, userOrganization, userOrganizationModule, module } from '../db/schema'
import type { Database } from '../db'
import { generateUUID, now } from '../utils'
import { UserRole } from '@jet-erp/shared'

// Constant-time comparison to prevent timing attacks
// Web Crypto API doesn't expose timingSafeEqual, so we use XOR accumulator
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
}

// Password hashing using Web Crypto API (Workers compatible)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)

  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // Import key for PBKDF2
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    data,
    'PBKDF2',
    false,
    ['deriveBits']
  )

  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )

  // Combine salt and hash
  const hashArray = new Uint8Array(derivedBits)
  const combined = new Uint8Array(salt.length + hashArray.length)
  combined.set(salt)
  combined.set(hashArray, salt.length)

  // Return as base64
  return btoa(String.fromCharCode(...combined))
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder()
    const data = encoder.encode(password)

    // Decode the stored hash
    const combined = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0))

    // Extract salt (first 16 bytes)
    const salt = combined.slice(0, 16)
    const storedHashBytes = combined.slice(16)

    // Import key for PBKDF2
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      data,
      'PBKDF2',
      false,
      ['deriveBits']
    )

    // Derive key using same params
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    )

    const hashArray = new Uint8Array(derivedBits)

    // Compare hashes using constant-time comparison
    return constantTimeEqual(hashArray, storedHashBytes)
  } catch {
    return false
  }
}

// Generate a secure random token
export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// Hash a session token for storage (deterministic, no salt needed since tokens are high-entropy)
export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray, b => b.toString(16).padStart(2, '0')).join('')
}

// Generate a 6-digit verification code
export function generateVerificationCode(): string {
  const array = crypto.getRandomValues(new Uint8Array(4))
  const num = new DataView(array.buffer).getUint32(0) % 1000000
  return num.toString().padStart(6, '0')
}

// Extract domain from email
export function extractDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() || ''
}

// Session management
export async function createSession(
  db: Database,
  userId: string,
  userAgent?: string,
  ipAddress?: string
): Promise<string> {
  const token = generateToken()
  const tokenHash = await hashSessionToken(token)
  const timestamp = now()
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days

  await db.insert(session).values({
    id: generateUUID(),
    userId,
    token: tokenHash,
    expiresAt,
    createdAt: timestamp,
    lastUsedAt: timestamp,
    userAgent,
    ipAddress,
  })

  // Return the raw token to the client; only the hash is stored
  return token
}

export async function validateSession(db: Database, token: string) {
  const tokenHash = await hashSessionToken(token)
  const sessions = await db
    .select()
    .from(session)
    .where(
      and(
        eq(session.token, tokenHash),
        gt(session.expiresAt, now())
      )
    )

  if (sessions.length === 0) return null

  const sess = sessions[0]

  // Update last used
  await db
    .update(session)
    .set({ lastUsedAt: now() })
    .where(eq(session.id, sess.id))

  return sess
}

export async function deleteSession(db: Database, token: string): Promise<void> {
  const tokenHash = await hashSessionToken(token)
  await db.delete(session).where(eq(session.token, tokenHash))
}

export async function deleteUserSessions(db: Database, userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId))
}

// Email verification
export async function createVerificationCode(
  db: Database,
  email: string,
  type: 'signup' | 'password_reset' | 'invite'
): Promise<string> {
  const code = generateVerificationCode()
  const timestamp = now()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

  // Delete any existing codes for this email/type
  await db
    .delete(emailVerification)
    .where(
      and(
        eq(emailVerification.email, email.toLowerCase()),
        eq(emailVerification.type, type)
      )
    )

  await db.insert(emailVerification).values({
    id: generateUUID(),
    email: email.toLowerCase(),
    code,
    type,
    expiresAt,
    createdAt: timestamp,
  })

  return code
}

export async function verifyCode(
  db: Database,
  email: string,
  code: string,
  type: 'signup' | 'password_reset' | 'invite'
): Promise<boolean> {
  const verifications = await db
    .select()
    .from(emailVerification)
    .where(
      and(
        eq(emailVerification.email, email.toLowerCase()),
        eq(emailVerification.code, code),
        eq(emailVerification.type, type),
        gt(emailVerification.expiresAt, now())
      )
    )

  if (verifications.length === 0) return false

  // Delete the used code
  await db
    .delete(emailVerification)
    .where(eq(emailVerification.id, verifications[0].id))

  return true
}

export async function checkVerificationCode(
  db: Database,
  email: string,
  code: string,
  type: 'signup' | 'password_reset' | 'invite'
): Promise<boolean> {
  const verifications = await db
    .select()
    .from(emailVerification)
    .where(
      and(
        eq(emailVerification.email, email.toLowerCase()),
        eq(emailVerification.code, code),
        eq(emailVerification.type, type),
        gt(emailVerification.expiresAt, now())
      )
    )

  return verifications.length > 0
}

// Organization lookup/creation
export async function findOrganizationByDomain(db: Database, domain: string) {
  const orgs = await db
    .select()
    .from(organization)
    .where(eq(organization.domain, domain.toLowerCase()))

  return orgs[0] || null
}

export async function createOrganization(
  db: Database,
  name: string,
  domain: string
): Promise<string> {
  const orgId = generateUUID()
  const timestamp = now()
  const slug = domain.split('.')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')

  await db.insert(organization).values({
    id: orgId,
    name,
    slug,
    domain: domain.toLowerCase(),
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  return orgId
}

// User creation with password
export async function createUserWithPassword(
  db: Database,
  organizationId: string,
  email: string,
  displayName: string,
  password: string,
  roleName: string = UserRole.REPORTER
): Promise<string> {
  const userId = generateUUID()
  const timestamp = now()
  const passwordHash = await hashPassword(password)

  // Create user record
  await db.insert(user).values({
    id: userId,
    organizationId,
    email: email.toLowerCase(),
    displayName,
    passwordHash,
    emailVerified: true,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  // Create userOrganization membership
  await db.insert(userOrganization).values({
    id: generateUUID(),
    userId,
    organizationId,
    isDefault: true,
    joinedAt: timestamp,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  })

  // Get QMS module
  const qmsModule = await db
    .select({ id: module.id })
    .from(module)
    .where(eq(module.code, 'qms'))
    .limit(1)

  // Create userOrganizationModule with role
  if (qmsModule.length > 0) {
    await db.insert(userOrganizationModule).values({
      id: generateUUID(),
      userId,
      organizationId,
      moduleId: qmsModule[0].id,
      role: roleName,
      isActive: true,
      grantedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  // Also create legacy userRole for backward compatibility
  const roleRecord = await db
    .select()
    .from(role)
    .where(eq(role.name, roleName))

  if (roleRecord.length > 0) {
    await db.insert(userRole).values({
      userId,
      roleId: roleRecord[0].id,
    })
  }

  return userId
}

// Find user by email (for login)
export async function findUserByEmail(db: Database, email: string) {
  const users = await db
    .select()
    .from(user)
    .where(eq(user.email, email.toLowerCase()))

  return users[0] || null
}

// Check if user exists in org via userOrganization membership
export async function userExistsInOrg(db: Database, email: string, organizationId: string): Promise<boolean> {
  // First find the user by email
  const users = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.toLowerCase()))
    .limit(1)

  if (users.length === 0) {
    return false
  }

  // Check if they're a member of this org
  const membership = await db
    .select()
    .from(userOrganization)
    .where(
      and(
        eq(userOrganization.userId, users[0].id),
        eq(userOrganization.organizationId, organizationId),
        eq(userOrganization.isActive, true)
      )
    )
    .limit(1)

  return membership.length > 0
}

// Invite management
export async function createInvite(
  db: Database,
  organizationId: string,
  email: string,
  roleName: string,
  invitedBy: string
): Promise<string> {
  const token = generateToken()
  const timestamp = now()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

  await db.insert(orgInvite).values({
    id: generateUUID(),
    organizationId,
    email: email.toLowerCase(),
    role: roleName,
    token,
    invitedBy,
    expiresAt,
    createdAt: timestamp,
  })

  return token
}

export async function getInviteByToken(db: Database, token: string) {
  const invites = await db
    .select({
      invite: orgInvite,
      org: organization,
    })
    .from(orgInvite)
    .innerJoin(organization, eq(orgInvite.organizationId, organization.id))
    .where(
      and(
        eq(orgInvite.token, token),
        gt(orgInvite.expiresAt, now()),
        isNull(orgInvite.usedAt)
      )
    )

  if (invites.length === 0) return null

  return {
    ...invites[0].invite,
    organization: invites[0].org,
  }
}

export async function markInviteUsed(db: Database, token: string, usedByEmail?: string): Promise<void> {
  await db
    .update(orgInvite)
    .set({
      usedAt: now(),
      usedByEmail: usedByEmail?.toLowerCase(),
    })
    .where(eq(orgInvite.token, token))
}

export async function getOrgInvites(db: Database, organizationId: string) {
  return db
    .select()
    .from(orgInvite)
    .where(eq(orgInvite.organizationId, organizationId))
}

export async function deleteInvite(db: Database, inviteId: string, organizationId: string): Promise<void> {
  await db
    .delete(orgInvite)
    .where(
      and(
        eq(orgInvite.id, inviteId),
        eq(orgInvite.organizationId, organizationId)
      )
    )
}
