import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types/bindings'
import {
  hashPassword,
  verifyPassword,
  createSession,
  validateSession,
  deleteSession,
  createVerificationCode,
  verifyCode,
  checkVerificationCode,
  createUserWithPassword,
  findUserByEmail,
  getInviteByToken,
  markInviteUsed,
} from '../services/auth'
import { getUserOrgRoles } from '../middleware/auth'
import { sendEmail, verificationCodeEmail, passwordResetEmail } from '../services/email'
import { checkRateLimit, clearRateLimit, getClientIp, AUTH_RATE_LIMITS } from '../services/rate-limit'
import { logAuthEvent, logAudit } from '../services/audit'

const auth = new Hono<{ Bindings: Env }>()

// Schema definitions
const signupStartSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
})

const verifyEmailSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
})

const completeSignupSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  password: z.string().min(8),
  displayName: z.string().min(1).max(100).optional(),
  inviteToken: z.string().min(1, 'Invite token is required'),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
})

const forgotPasswordSchema = z.object({
  email: z.string().email(),
})

const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8),
})

const microsoftAuthSchema = z.object({
  idToken: z.string().min(1),
  inviteToken: z.string().optional(),
})

/**
 * Check if two emails match, either exactly or via domain aliases.
 * For example, if terrasmart.com and rbi.gibraltar1.com are aliases for the org,
 * then user@terrasmart.com matches user@rbi.gibraltar1.com.
 */
export async function checkEmailMatchWithAliases(
  db: import('../db/index').Database,
  inviteEmail: string,
  ssoEmail: string,
  organizationId: string
): Promise<boolean> {
  const inviteEmailLower = inviteEmail.toLowerCase()
  const ssoEmailLower = ssoEmail.toLowerCase()

  // Check exact match first
  if (inviteEmailLower === ssoEmailLower) {
    return true
  }

  // Extract username and domain from both emails
  const inviteParts = inviteEmailLower.split('@')
  const ssoParts = ssoEmailLower.split('@')

  if (inviteParts.length !== 2 || ssoParts.length !== 2) {
    return false
  }

  const [inviteUsername, inviteDomain] = inviteParts
  const [ssoUsername, ssoDomain] = ssoParts

  // Usernames must match for alias matching
  if (inviteUsername !== ssoUsername) {
    return false
  }

  // Check if both domains are in the org's domain alias list
  const { domainAlias } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')

  const aliases = await db
    .select({ domain: domainAlias.domain })
    .from(domainAlias)
    .where(eq(domainAlias.organizationId, organizationId))

  const aliasDomains = new Set(aliases.map((a: { domain: string }) => a.domain))

  // Both domains must be in the alias list for a match
  return aliasDomains.has(inviteDomain) && aliasDomains.has(ssoDomain)
}

// POST /api/auth/signup - Start signup (sends verification code)
auth.post('/signup', async (c) => {
  // Rate limit by IP
  const ip = getClientIp(c)
  const rateLimit = await checkRateLimit(c.env, `signup:${ip}`, AUTH_RATE_LIMITS.signup)
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'Too many signup attempts. Please try again later.' },
      429,
      { 'Retry-After': rateLimit.retryAfter.toString() }
    )
  }

  const body = await c.req.json()
  const parsed = signupStartSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email } = parsed.data
  const db = c.get('db')

  // Check if user already exists
  const existingUser = await findUserByEmail(db, email)
  if (existingUser) {
    return c.json({ error: 'An account with this email already exists' }, 400)
  }

  // Create verification code
  const code = await createVerificationCode(db, email, 'signup')

  // Send verification email
  const emailContent = verificationCodeEmail(code)
  await sendEmail(c.env.RESEND_API_KEY, {
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
  })

  // Only return code in dev mode - never in production
  const isDev = c.env.ENVIRONMENT !== 'production'

  // Fail hard if email isn't configured in production
  if (!isDev && !c.env.RESEND_API_KEY) {
    console.error('[AUTH] RESEND_API_KEY not configured in production')
    return c.json({ error: 'Email service not configured' }, 503)
  }

  return c.json({
    message: 'Verification code sent to your email',
    // In development, return the code for testing
    ...(isDev && { devCode: code }),
  })
})

// POST /api/auth/verify - Verify email code
auth.post('/verify', async (c) => {
  // Rate limit by email to prevent brute-force on verification codes
  const body = await c.req.json()
  const parsed = verifyEmailSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email, code } = parsed.data

  const rateLimit = await checkRateLimit(c.env, `verify:${email.toLowerCase()}`, AUTH_RATE_LIMITS.verification)
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'Too many verification attempts. Please try again later.' },
      429,
      { 'Retry-After': rateLimit.retryAfter.toString() }
    )
  }

  const db = c.get('db')

  const isValid = await checkVerificationCode(db, email, code, 'signup')

  if (!isValid) {
    return c.json({ error: 'Invalid or expired verification code' }, 400)
  }

  return c.json({
    message: 'Email verified successfully',
    verified: true,
  })
})

// POST /api/auth/complete-signup - Set password and create account
auth.post('/complete-signup', async (c) => {
  const body = await c.req.json()
  const parsed = completeSignupSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email, code, password, displayName: providedName, inviteToken } = parsed.data
  const db = c.get('db')

  // Validate invite token (required for all signups)
  const invite = await getInviteByToken(db, inviteToken)
  if (!invite) {
    return c.json({ error: 'Invalid or expired invite' }, 400)
  }

  // Enforce email match (exact or via domain aliases)
  const emailMatch = await checkEmailMatchWithAliases(db, invite.email, email, invite.organization.id)
  if (!emailMatch) {
    return c.json({ error: 'This invite was sent to a different email address' }, 403)
  }

  // Check if user already exists
  const existingUser = await findUserByEmail(db, email)

  // Use the organization from the invite
  const organizationId = invite.organization.id
  const displayName = providedName || email.split('@')[0] // Default display name

  let userId: string

  if (existingUser) {
    // If user exists but was soft-deleted, reactivate them
    if (existingUser.deletedAt) {
      const isVerified = await verifyCode(db, email, code, 'signup')
      if (!isVerified) {
        return c.json({ error: 'Invalid or expired verification code' }, 400)
      }

      const { user: userTable, userOrganization, userOrganizationModule, module } = await import('../db/schema')
      const { eq, and } = await import('drizzle-orm')

      const passwordHash = await hashPassword(password)

      await db
        .update(userTable)
        .set({
          deletedAt: null,
          isActive: true,
          passwordHash,
          displayName,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userTable.id, existingUser.id))

      userId = existingUser.id

      // Check if user already has membership in this org
      const existingMembership = await db
        .select()
        .from(userOrganization)
        .where(and(
          eq(userOrganization.userId, userId),
          eq(userOrganization.organizationId, organizationId)
        ))
        .limit(1)

      const timestamp = new Date().toISOString()

      if (existingMembership.length > 0) {
        // Reactivate membership
        await db
          .update(userOrganization)
          .set({ isActive: true, updatedAt: timestamp })
          .where(and(
            eq(userOrganization.userId, userId),
            eq(userOrganization.organizationId, organizationId)
          ))
      } else {
        // Create new membership
        await db.insert(userOrganization).values({
          id: crypto.randomUUID(),
          userId,
          organizationId,
          isDefault: true,
          joinedAt: timestamp,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      }

      // Update or create module role
      const qmsModule = await db
        .select({ id: module.id })
        .from(module)
        .where(eq(module.code, 'erp'))
        .limit(1)

      if (qmsModule.length > 0) {
        const existingModuleRole = await db
          .select()
          .from(userOrganizationModule)
          .where(and(
            eq(userOrganizationModule.userId, userId),
            eq(userOrganizationModule.organizationId, organizationId),
            eq(userOrganizationModule.moduleId, qmsModule[0].id)
          ))
          .limit(1)

        if (existingModuleRole.length > 0) {
          await db
            .update(userOrganizationModule)
            .set({ role: invite.role, isActive: true, updatedAt: timestamp })
            .where(and(
              eq(userOrganizationModule.userId, userId),
              eq(userOrganizationModule.organizationId, organizationId),
              eq(userOrganizationModule.moduleId, qmsModule[0].id)
            ))
        } else {
          await db.insert(userOrganizationModule).values({
            id: crypto.randomUUID(),
            userId,
            organizationId,
            moduleId: qmsModule[0].id,
            role: invite.role,
            isActive: true,
            grantedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
      }
    } else {
      // User exists and is not deleted - can't create account
      return c.json({ error: 'An account with this email already exists' }, 400)
    }
  } else {
    const isVerified = await verifyCode(db, email, code, 'signup')
    if (!isVerified) {
      return c.json({ error: 'Invalid or expired verification code' }, 400)
    }

    // Create the user with proper org membership
    userId = await createUserWithPassword(
      db,
      organizationId,
      email,
      displayName,
      password,
      invite.role
    )
  }

  // Mark invite as used with the actual email that signed up
  await markInviteUsed(db, inviteToken, email)

  // Create session
  const userAgent = c.req.header('User-Agent')
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')
  const token = await createSession(db, userId, userAgent, ipAddress || undefined)

  // Get user roles from new multi-org system (falls back to legacy)
  const roles = await getUserOrgRoles(db, userId, organizationId)

  await logAuthEvent(c, db, { eventType: 'signup', email, userId, success: true })

  return c.json({
    message: 'Account created successfully',
    token,
    user: {
      id: userId,
      email,
      displayName,
      organizationId,
      roles,
    },
  })
})

// POST /api/auth/login - Login with email and password
auth.post('/login', async (c) => {
  // Rate limit by IP
  const ip = getClientIp(c)
  const rateLimit = await checkRateLimit(c.env, `login:${ip}`, AUTH_RATE_LIMITS.login)
  if (!rateLimit.allowed) {
    const db = c.get('db')
    await logAuthEvent(c, db, { eventType: 'login_failed', success: false, failureReason: 'ip_rate_limited' })
    return c.json(
      { error: 'Too many login attempts. Please try again later.' },
      429,
      { 'Retry-After': rateLimit.retryAfter.toString() }
    )
  }

  const body = await c.req.json()
  const parsed = loginSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email, password } = parsed.data

  // Rate limit by email (account-level lockout to prevent distributed brute-force)
  const accountRateLimit = await checkRateLimit(c.env, `login-account:${email.toLowerCase()}`, AUTH_RATE_LIMITS.loginAccount)
  if (!accountRateLimit.allowed) {
    const db = c.get('db')
    await logAuthEvent(c, db, { eventType: 'account_locked', email, success: false, failureReason: 'account_rate_limited' })
    return c.json(
      { error: 'Account temporarily locked due to too many failed attempts. Please try again later.' },
      429,
      { 'Retry-After': accountRateLimit.retryAfter.toString() }
    )
  }

  const db = c.get('db')

  const user = await findUserByEmail(db, email)

  if (!user) {
    await logAuthEvent(c, db, { eventType: 'login_failed', email, success: false, failureReason: 'user_not_found' })
    return c.json({ error: 'Invalid email or password', attemptsRemaining: accountRateLimit.remaining }, 401)
  }

  if (!user.passwordHash || !user.isActive) {
    await logAuthEvent(c, db, { eventType: 'login_failed', email, userId: user.id, success: false, failureReason: user.isActive ? 'no_password' : 'account_deactivated' })
    return c.json({ error: 'Invalid email or password', attemptsRemaining: accountRateLimit.remaining }, 401)
  }

  const isValid = await verifyPassword(password, user.passwordHash)

  if (!isValid) {
    await logAuthEvent(c, db, { eventType: 'login_failed', email, userId: user.id, success: false, failureReason: 'invalid_password' })
    return c.json({ error: 'Invalid email or password', attemptsRemaining: accountRateLimit.remaining }, 401)
  }

  // Create session
  const userAgent = c.req.header('User-Agent')
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')
  const token = await createSession(db, user.id, userAgent, ipAddress || undefined)

  // Get user roles from new multi-org system (falls back to legacy)
  const roles = await getUserOrgRoles(db, user.id, user.organizationId!)

  await logAuthEvent(c, db, { eventType: 'login_success', email, userId: user.id, success: true })

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      organizationId: user.organizationId,
      roles,
    },
  })
})

// POST /api/auth/microsoft - Login with Microsoft ID token
auth.post('/microsoft', async (c) => {
  const body = await c.req.json()
  const parsed = microsoftAuthSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { idToken, inviteToken } = parsed.data
  const db = c.get('db')

  try {
    if (!c.env.AZURE_CLIENT_ID) {
      return c.json({ error: 'SSO not configured' }, 500)
    }
    // Import jose for JWT validation
    const { createRemoteJWKSet, jwtVerify } = await import('jose')

    // Microsoft's JWKS endpoint for token validation
    const JWKS = createRemoteJWKSet(
      new URL('https://login.microsoftonline.com/common/discovery/v2.0/keys')
    )

    // Verify the token
    const { payload } = await jwtVerify(idToken, JWKS, {
      audience: c.env.AZURE_CLIENT_ID,
    })

    // Validate issuer manually (Microsoft uses tenant-specific issuers)
    const iss = payload.iss as string
    if (!iss || !iss.startsWith('https://login.microsoftonline.com/')) {
      return c.json({ error: 'Invalid token issuer' }, 401)
    }

    // Extract user info from token
    const email = (payload.email || payload.preferred_username) as string
    const displayName = (payload.name || email?.split('@')[0] || 'User') as string

    if (!email) {
      return c.json({ error: 'Email not found in token' }, 400)
    }

    // If invite token provided, validate it
    let invite = null
    if (inviteToken) {
      invite = await getInviteByToken(db, inviteToken)
      if (!invite) {
        return c.json({ error: 'Invalid or expired invite' }, 400)
      }
      if (invite.usedAt) {
        return c.json({ error: 'Invite has already been used' }, 400)
      }

      // Enforce email match (exact or via domain aliases)
      const emailMatch = await checkEmailMatchWithAliases(db, invite.email, email, invite.organization.id)
      if (!emailMatch) {
        return c.json({ error: 'This invite was sent to a different email address' }, 403)
      }
    }

    // Find or create user
    const { user: userTable, userOrganization, userOrganizationModule, module } = await import('../db/schema')
    const { eq, and } = await import('drizzle-orm')

    let foundUser = await findUserByEmail(db, email)

    // Also check by Entra Object ID in case the user's email changed in Microsoft
    const entraObjectId = payload.oid as string
    if (!foundUser && entraObjectId) {
      const userByEntraId = await db
        .select()
        .from(userTable)
        .where(eq(userTable.entraObjectId, entraObjectId))
        .limit(1)

      if (userByEntraId.length > 0) {
        // User found by Entra ID - update their email to match Microsoft
        foundUser = userByEntraId[0]
        await db
          .update(userTable)
          .set({
            email: email.toLowerCase(),
            displayName,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(userTable.id, foundUser.id))
        foundUser.email = email.toLowerCase()
      }
    }

    if (!foundUser) {
      // Determine organization: from invite, or by email domain lookup
      let organizationId: string | null = null

      if (invite) {
        organizationId = invite.organization.id
      } else {
        // Auto-provision: look up org by email domain
        const emailDomain = email.toLowerCase().split('@')[1]
        if (emailDomain) {
          const { organization: orgTable, domainAlias } = await import('../db/schema')

          // Check organization.domain first
          const orgByDomain = await db
            .select({ id: orgTable.id })
            .from(orgTable)
            .where(and(eq(orgTable.domain, emailDomain), eq(orgTable.isActive, true)))
            .limit(1)

          if (orgByDomain.length > 0) {
            organizationId = orgByDomain[0].id
          } else {
            // Check domain_alias table
            const aliasByDomain = await db
              .select({ organizationId: domainAlias.organizationId })
              .from(domainAlias)
              .where(eq(domainAlias.domain, emailDomain))
              .limit(1)

            if (aliasByDomain.length > 0) {
              organizationId = aliasByDomain[0].organizationId
            }
          }
        }

        if (!organizationId) {
          return c.json({ error: 'No organization found for your email domain. Contact your administrator.' }, 400)
        }
      }

      const timestamp = new Date().toISOString()

      // Create new user
      const userId = crypto.randomUUID()
      await db.insert(userTable).values({
        id: userId,
        organizationId,
        email: email.toLowerCase(),
        displayName,
        entraObjectId: payload.oid as string || null,
        emailVerified: true,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      // Create userOrganization membership
      await db.insert(userOrganization).values({
        id: crypto.randomUUID(),
        userId,
        organizationId,
        isDefault: true,
        joinedAt: timestamp,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      if (invite) {
        // Invited users get the role specified in the invite
        const qmsModule = await db
          .select({ id: module.id })
          .from(module)
          .where(eq(module.code, 'erp'))
          .limit(1)

        if (qmsModule.length > 0) {
          await db.insert(userOrganizationModule).values({
            id: crypto.randomUUID(),
            userId,
            organizationId,
            moduleId: qmsModule[0].id,
            role: invite.role,
            isActive: true,
            grantedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }

        await markInviteUsed(db, inviteToken!, email)
      }
      // Auto-provisioned users (no invite) get no module roles — admin must assign

      await logAudit(c, {
        action: 'user.auto_provision',
        resource: 'user',
        resourceId: userId,
        metadata: { email: email.toLowerCase(), organizationId, method: invite ? 'invite' : 'domain_match' },
      })

      foundUser = {
        id: userId,
        email: email.toLowerCase(),
        displayName,
        organizationId,
        isActive: true,
        deletedAt: null,
      } as typeof foundUser
    } else if (!foundUser.isActive) {
      return c.json({ error: 'Account is deactivated' }, 403)
    } else if (foundUser.deletedAt) {
      // Reactivate soft-deleted user
      await db
        .update(userTable)
        .set({
          deletedAt: null,
          isActive: true,
          entraObjectId: payload.oid as string || foundUser.entraObjectId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userTable.id, foundUser.id))

      // If reactivating with an invite, add org membership and mark invite used
      if (invite) {
        const organizationId = invite.organization.id
        const timestamp = new Date().toISOString()

        // Check if user already has membership in this org
        const existingMembership = await db
          .select()
          .from(userOrganization)
          .where(and(
            eq(userOrganization.userId, foundUser.id),
            eq(userOrganization.organizationId, organizationId)
          ))
          .limit(1)

        if (existingMembership.length > 0) {
          await db
            .update(userOrganization)
            .set({ isActive: true, updatedAt: timestamp })
            .where(and(
              eq(userOrganization.userId, foundUser.id),
              eq(userOrganization.organizationId, organizationId)
            ))
        } else {
          await db.insert(userOrganization).values({
            id: crypto.randomUUID(),
            userId: foundUser.id,
            organizationId,
            isDefault: false,
            joinedAt: timestamp,
            isActive: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }

        // Update or create module role
        const qmsModule = await db
          .select({ id: module.id })
          .from(module)
          .where(eq(module.code, 'erp'))
          .limit(1)

        if (qmsModule.length > 0) {
          const existingModuleRole = await db
            .select()
            .from(userOrganizationModule)
            .where(and(
              eq(userOrganizationModule.userId, foundUser.id),
              eq(userOrganizationModule.organizationId, organizationId),
              eq(userOrganizationModule.moduleId, qmsModule[0].id)
            ))
            .limit(1)

          if (existingModuleRole.length > 0) {
            await db
              .update(userOrganizationModule)
              .set({ role: invite.role, isActive: true, updatedAt: timestamp })
              .where(and(
                eq(userOrganizationModule.userId, foundUser.id),
                eq(userOrganizationModule.organizationId, organizationId),
                eq(userOrganizationModule.moduleId, qmsModule[0].id)
              ))
          } else {
            await db.insert(userOrganizationModule).values({
              id: crypto.randomUUID(),
              userId: foundUser.id,
              organizationId,
              moduleId: qmsModule[0].id,
              role: invite.role,
              isActive: true,
              grantedAt: timestamp,
              createdAt: timestamp,
              updatedAt: timestamp,
            })
          }
        }

        await markInviteUsed(db, inviteToken!, email)
      }
    } else if (invite) {
      // Existing active user with invite - add to org if not already member
      const organizationId = invite.organization.id
      const timestamp = new Date().toISOString()

      const existingMembership = await db
        .select()
        .from(userOrganization)
        .where(and(
          eq(userOrganization.userId, foundUser.id),
          eq(userOrganization.organizationId, organizationId)
        ))
        .limit(1)

      if (existingMembership.length === 0) {
        await db.insert(userOrganization).values({
          id: crypto.randomUUID(),
          userId: foundUser.id,
          organizationId,
          isDefault: false,
          joinedAt: timestamp,
          isActive: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        })

        // Create module role
        const qmsModule = await db
          .select({ id: module.id })
          .from(module)
          .where(eq(module.code, 'erp'))
          .limit(1)

        if (qmsModule.length > 0) {
          await db.insert(userOrganizationModule).values({
            id: crypto.randomUUID(),
            userId: foundUser.id,
            organizationId,
            moduleId: qmsModule[0].id,
            role: invite.role,
            isActive: true,
            grantedAt: timestamp,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        }
      } else if (!existingMembership[0].isActive) {
        // Reactivate membership
        await db
          .update(userOrganization)
          .set({ isActive: true, updatedAt: timestamp })
          .where(and(
            eq(userOrganization.userId, foundUser.id),
            eq(userOrganization.organizationId, organizationId)
          ))
      }

      await markInviteUsed(db, inviteToken!, email)
    }

    // Create session
    const userAgent = c.req.header('User-Agent')
    const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')
    const token = await createSession(db, foundUser.id, userAgent, ipAddress || undefined)

    // Get user roles from new multi-org system (falls back to legacy)
    const roles = await getUserOrgRoles(db, foundUser.id, foundUser.organizationId!)

    await logAuthEvent(c, db, { eventType: 'login_success', email: foundUser.email, userId: foundUser.id, success: true })

    return c.json({
      token,
      user: {
        id: foundUser.id,
        email: foundUser.email,
        displayName: foundUser.displayName,
        organizationId: foundUser.organizationId,
        roles,
      },
    })
  } catch (error: any) {
    console.error('Microsoft auth error:', error)
    const db = c.get('db')
    await logAuthEvent(c, db, { eventType: 'login_failed', success: false, failureReason: 'microsoft_auth_error' })
    const errorMessage = error?.message || 'Unknown error'
    if (errorMessage.includes('exp') || errorMessage.includes('expired')) {
      return c.json({ error: 'Microsoft token expired. Please try signing in again.' }, 401)
    }
    return c.json({ error: 'Authentication failed. Please try again.' }, 401)
  }
})

// POST /api/auth/logout - Logout (invalidate session)
auth.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const db = c.get('db')
    const sess = await validateSession(db, token)
    await deleteSession(db, token)
    if (sess) {
      await logAuthEvent(c, db, { eventType: 'logout', userId: sess.userId, success: true })
    }
  }

  return c.json({ message: 'Logged out successfully' })
})

// POST /api/auth/forgot-password - Send password reset code
auth.post('/forgot-password', async (c) => {
  // Rate limit by IP to prevent abuse
  const ip = getClientIp(c)
  const rateLimit = await checkRateLimit(c.env, `forgot-password:${ip}`, AUTH_RATE_LIMITS.passwordReset)
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'Too many password reset attempts. Please try again later.' },
      429,
      { 'Retry-After': rateLimit.retryAfter.toString() }
    )
  }

  const body = await c.req.json()
  const parsed = forgotPasswordSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email } = parsed.data
  const db = c.get('db')

  const user = await findUserByEmail(db, email)

  // Always return success to prevent email enumeration
  if (!user || !user.passwordHash) {
    return c.json({ message: 'If an account exists, a reset code has been sent' })
  }

  const code = await createVerificationCode(db, email, 'password_reset')

  // Send password reset email
  const emailContent = passwordResetEmail(code)
  await sendEmail(c.env.RESEND_API_KEY, {
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
  })

  // Only return code in dev mode - never in production
  const isDev = c.env.ENVIRONMENT !== 'production'

  // Fail hard if email isn't configured in production
  if (!isDev && !c.env.RESEND_API_KEY) {
    console.error('[AUTH] RESEND_API_KEY not configured in production')
    return c.json({ error: 'Email service not configured' }, 503)
  }

  return c.json({
    message: 'If an account exists, a reset code has been sent',
    // In development, return the code for testing
    ...(isDev && { devCode: code }),
  })
})

// POST /api/auth/reset-password - Reset password with code
auth.post('/reset-password', async (c) => {
  const body = await c.req.json()
  const parsed = resetPasswordSchema.safeParse(body)

  if (!parsed.success) {
    return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400)
  }

  const { email, code, newPassword } = parsed.data

  // Rate limit by email to prevent brute-force on reset codes
  const rateLimit = await checkRateLimit(c.env, `reset-verify:${email.toLowerCase()}`, AUTH_RATE_LIMITS.verification)
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'Too many verification attempts. Please try again later.' },
      429,
      { 'Retry-After': rateLimit.retryAfter.toString() }
    )
  }

  const db = c.get('db')

  const isValid = await verifyCode(db, email, code, 'password_reset')

  if (!isValid) {
    return c.json({ error: 'Invalid or expired reset code' }, 400)
  }

  const foundUser = await findUserByEmail(db, email)
  if (!foundUser) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Hash new password and update user
  const passwordHash = await hashPassword(newPassword)

  const { user: userTable } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')

  await db
    .update(userTable)
    .set({
      passwordHash,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userTable.id, foundUser.id))

  // Invalidate all existing sessions
  const { deleteUserSessions } = await import('../services/auth')
  await deleteUserSessions(db, foundUser.id)

  // Clear login rate limits so the user can log in immediately with new password
  await clearRateLimit(c.env, `login-account:${email.toLowerCase()}`)
  const resetIp = getClientIp(c)
  await clearRateLimit(c.env, `login:${resetIp}`)

  await logAuthEvent(c, db, { eventType: 'password_reset', email, userId: foundUser.id, success: true })

  return c.json({ message: 'Password reset successfully' })
})

// GET /api/auth/invite/:token - Validate invite and get org info
auth.get('/invite/:token', async (c) => {
  // Rate limit invite token validation to prevent enumeration
  const ip = getClientIp(c)
  const rateLimit = await checkRateLimit(c.env, `invite-validate:${ip}`, AUTH_RATE_LIMITS.inviteValidation)
  if (!rateLimit.allowed) {
    return c.json(
      { error: 'Too many requests. Please try again later.' },
      429,
      { 'Retry-After': rateLimit.retryAfter.toString() }
    )
  }

  const token = c.req.param('token')
  const db = c.get('db')

  const invite = await getInviteByToken(db, token)

  if (!invite) {
    return c.json({ error: 'Invalid or expired invite' }, 404)
  }

  if (invite.usedAt) {
    return c.json({ error: 'Invite has already been used' }, 400)
  }

  return c.json({
    email: invite.email,
    role: invite.role,
    organization: {
      id: invite.organization.id,
      name: invite.organization.name,
    },
    expiresAt: invite.expiresAt,
  })
})

// POST /api/auth/dev-login - Auto-login for development (requires BOTH flags)
auth.post('/dev-login', async (c) => {
  if (c.env.ALLOW_DEV_AUTH !== 'true' || c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Dev login not available' }, 403)
  }

  const db = c.get('db')
  const devUserId = '00000000-0000-0000-0000-000000000001'

  const userAgent = c.req.header('User-Agent')
  const ipAddress = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')
  const token = await createSession(db, devUserId, userAgent, ipAddress || undefined)

  const { user: userTable } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')

  const users = await db.select().from(userTable).where(eq(userTable.id, devUserId))

  if (users.length === 0) {
    return c.json({ error: 'Dev user not found - run seed.sql' }, 500)
  }

  const devUser = users[0]
  // Get user roles from new multi-org system (falls back to legacy)
  const roles = await getUserOrgRoles(db, devUser.id, devUser.organizationId!)

  return c.json({
    token,
    user: {
      id: devUser.id,
      email: devUser.email,
      displayName: devUser.displayName,
      organizationId: devUser.organizationId,
      roles,
    },
  })
})

// GET /api/auth/me - Get current user from session
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  const token = authHeader.slice(7)
  const db = c.get('db')

  const sess = await validateSession(db, token)

  if (!sess) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }

  // Get user info
  const { user: userTable } = await import('../db/schema')
  const { eq } = await import('drizzle-orm')

  const users = await db
    .select()
    .from(userTable)
    .where(eq(userTable.id, sess.userId))

  if (users.length === 0) {
    return c.json({ error: 'User not found' }, 404)
  }

  const foundUser = users[0]
  // Get user roles from new multi-org system (falls back to legacy)
  const roles = await getUserOrgRoles(db, foundUser.id, foundUser.organizationId!)

  return c.json({
    id: foundUser.id,
    email: foundUser.email,
    displayName: foundUser.displayName,
    organizationId: foundUser.organizationId,
    roles,
  })
})

export default auth
