import type { AuthContext } from '../types/auth'

/**
 * Returns the effective roles for the current request context.
 * When module context is set, role checks should be module-scoped.
 * Prefers moduleRoles array over singular moduleRole for multi-select support.
 */
export function getScopedRoles(auth: AuthContext): string[] {
  if (auth.isDevRoleOverride) {
    return auth.roles
  }
  if (auth.moduleRoles && auth.moduleRoles.length > 0) {
    return auth.moduleRoles
  }
  if (auth.moduleRole) {
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
