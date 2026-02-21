import type { AuthContext } from '../types/auth'

/**
 * Returns the effective roles for the current request context.
 * When module context is set, role checks should be module-scoped.
 */
export function getScopedRoles(auth: AuthContext): string[] {
  if (auth.moduleRole && !auth.isDevRoleOverride) {
    return [auth.moduleRole]
  }
  return auth.roles
}

export function hasScopedRole(auth: AuthContext, role: string): boolean {
  return getScopedRoles(auth).includes(role)
}

export function hasAnyScopedRole(auth: AuthContext, roles: string[]): boolean {
  const scopedRoles = getScopedRoles(auth)
  return roles.some((role) => scopedRoles.includes(role))
}
