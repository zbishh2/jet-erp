import type { UserRole } from '@jet-erp/shared'
import type { Database } from '../db'

// User's organization membership
export interface UserOrg {
  id: string
  name: string
  slug: string
  isDefault: boolean
}

export interface AuthContext {
  userId: string
  email: string
  displayName: string

  // Current org context (from X-Organization-Id header or auto-selected)
  organizationId: string

  // All user's orgs
  organizations: UserOrg[]

  // Platform admin flag
  isPlatformAdmin: boolean

  // Module context (set by module middleware)
  moduleId?: string
  moduleCode?: string
  moduleRole?: string
  isDevRoleOverride?: boolean

  // Deprecated: Use moduleRole instead. Kept for backward compat during migration.
  roles: UserRole[]
}

export interface DevUserConfig {
  userId: string
  organizationId: string
  email: string
  displayName: string
  roles: UserRole[]
  organizations?: UserOrg[]
  isPlatformAdmin?: boolean
}

declare module 'hono' {
  interface ContextVariableMap {
    auth: AuthContext
    db: Database
    kv: KVNamespace
    r2: R2Bucket
  }
}
