import { createMiddleware } from 'hono/factory'
import type { AuthContext } from '../types/auth'
import { UserRole } from '@jet-erp/shared'
import { hasAnyScopedRole, getScopedRoles } from './role-scope'

// Middleware factory to require specific role(s)
export function requireRole(...allowedRoles: UserRole[]) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined

    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const hasRequiredRole = hasAnyScopedRole(auth, allowedRoles)

    if (!hasRequiredRole) {
      return c.json({
        error: 'Forbidden',
        message: `Requires one of: ${allowedRoles.join(', ')}`
      }, 403)
    }

    return next()
  })
}

// Middleware factory to require specific module role(s) from module context
export function requireModuleRole(...allowedRoles: string[]) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined

    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const scopedRoles = getScopedRoles(auth)

    if (!scopedRoles.some((role) => allowedRoles.includes(role))) {
      return c.json({
        error: 'Forbidden',
        message: `Requires one of: ${allowedRoles.join(', ')}`
      }, 403)
    }

    return next()
  })
}

interface ModuleRolePolicy {
  read: string[]
  write?: string[]
  del?: string[]
}

// Method-aware module RBAC: read for GET/HEAD/OPTIONS, write for POST/PUT/PATCH, del for DELETE.
export function requireModuleRolePolicy(policy: ModuleRolePolicy) {
  return createMiddleware(async (c, next) => {
    const auth = c.get('auth') as AuthContext | undefined

    if (!auth) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const method = c.req.method.toUpperCase()
    let allowedRoles = policy.read

    if (method === 'DELETE') {
      allowedRoles = policy.del ?? policy.write ?? policy.read
    } else if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      allowedRoles = policy.write ?? policy.read
    }

    const scopedRoles = getScopedRoles(auth)

    if (!scopedRoles.some((role) => allowedRoles.includes(role))) {
      return c.json({
        error: 'Forbidden',
        message: `Requires one of: ${allowedRoles.join(', ')}`,
      }, 403)
    }

    return next()
  })
}

// Convenience middleware for admin-only routes
export const requireAdmin = requireRole(UserRole.ADMIN)

// Convenience middleware for quality + admin routes
export const requireQualityOrAdmin = requireRole(UserRole.QUALITY, UserRole.ADMIN)
