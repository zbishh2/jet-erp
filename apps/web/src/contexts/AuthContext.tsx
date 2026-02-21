import { createContext, useContext, ReactNode, useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/api/client'
import { getToken, setToken, clearToken, isAuthenticated } from '@/lib/auth'
import type { UserRole } from '@jet-erp/shared'

const isLocalhost = typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

// Permission keys that match the backend
type PermissionKey =
  | 'ncr.create'
  | 'ncr.edit'
  | 'ncr.delete'
  | 'ncr.transition'
  | 'ncr.assign'
  | 'ncr.close'
  | 'rca.create'
  | 'rca.edit'
  | 'rca.delete'
  | 'rca.approve'
  | 'ca.create'
  | 'ca.edit'
  | 'ca.delete'
  | 'ca.transition'
  | 'ca.verify'
  | 'admin.users'
  | 'admin.config'

interface PermissionsData {
  data: {
    roles: UserRole[]
    permissions: Record<PermissionKey, boolean>
  }
}

interface UserOrg {
  id: string
  name: string
  slug: string
  isDefault: boolean
}

interface UserDataInner {
  id: string
  organizationId: string
  email: string
  displayName: string
  roles: UserRole[]
  organizations?: UserOrg[]
  isPlatformAdmin?: boolean
}

interface UserDataResponse {
  data: UserDataInner
}

interface AuthContextValue {
  user: UserDataInner | null
  roles: UserRole[]
  permissions: Record<PermissionKey, boolean>
  isLoading: boolean
  isAuthenticated: boolean
  isPlatformAdmin: boolean
  error: Error | null
  hasPermission: (permission: PermissionKey) => boolean
  hasRole: (role: UserRole) => boolean
  hasAnyRole: (roles: UserRole[]) => boolean
  login: (token: string) => void
  logout: () => void
}

const defaultPermissions: Record<PermissionKey, boolean> = {
  'ncr.create': false,
  'ncr.edit': false,
  'ncr.delete': false,
  'ncr.transition': false,
  'ncr.assign': false,
  'ncr.close': false,
  'rca.create': false,
  'rca.edit': false,
  'rca.delete': false,
  'rca.approve': false,
  'ca.create': false,
  'ca.edit': false,
  'ca.delete': false,
  'ca.transition': false,
  'ca.verify': false,
  'admin.users': false,
  'admin.config': false,
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const queryClient = useQueryClient()
  const [devLoginAttempted, setDevLoginAttempted] = useState(false)
  const [devLoginLoading, setDevLoginLoading] = useState(isLocalhost && !isAuthenticated())
  // Track token presence in state so login()/logout() trigger re-renders
  const [hasToken, setHasToken] = useState(() => isAuthenticated())

  // Auto-login for localhost development
  useEffect(() => {
    if (isLocalhost && !hasToken && !devLoginAttempted) {
      setDevLoginAttempted(true)
      setDevLoginLoading(true)
      apiFetch<{ token: string }>('/auth/dev-login', { method: 'POST', skipAuth: true })
        .then((data) => {
          if (data.token) {
            setToken(data.token)
            setHasToken(true)
            queryClient.invalidateQueries({ queryKey: ['me'] })
          }
        })
        .catch(() => {
          // Dev login not available, user will need to login normally
        })
        .finally(() => {
          setDevLoginLoading(false)
        })
    }
  }, [hasToken, devLoginAttempted, queryClient])

  // Fetch user info only if we have a token
  const userQuery = useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<UserDataResponse>('/me'),
    staleTime: 1000 * 60 * 10, // 10 minutes
    retry: false,
    enabled: hasToken,
  })

  // Fetch permissions only if we have a token
  const permissionsQuery = useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: () => apiFetch<PermissionsData>('/me/permissions'),
    staleTime: 1000 * 60 * 10, // 10 minutes
    retry: false,
    enabled: hasToken,
  })

  const user = userQuery.data?.data ?? null
  const roles = permissionsQuery.data?.data?.roles ?? []
  const permissions = permissionsQuery.data?.data?.permissions ?? defaultPermissions

  const hasPermission = (permission: PermissionKey): boolean => {
    return permissions[permission] ?? false
  }

  const hasRole = (role: UserRole): boolean => {
    return roles.includes(role)
  }

  const hasAnyRole = (checkRoles: UserRole[]): boolean => {
    return checkRoles.some(role => roles.includes(role))
  }

  const login = useCallback((token: string) => {
    setToken(token)
    setHasToken(true)
    // Refetch user data and all related queries
    // Use refetchType: 'all' to ensure disabled queries are also reset
    queryClient.invalidateQueries({ queryKey: ['me'], refetchType: 'all' })
    // Also explicitly reset the organizations query so it fetches fresh when enabled
    queryClient.resetQueries({ queryKey: ['me', 'organizations'] })
  }, [queryClient])

  const logout = useCallback(() => {
    // Call logout endpoint (best effort)
    const token = getToken()
    if (token) {
      apiFetch('/auth/logout', { method: 'POST' }).catch(() => {
        // Ignore errors
      })
    }
    clearToken()
    setHasToken(false)
    queryClient.clear()
  }, [queryClient])

  // If user query failed with 401, clear token
  if (userQuery.error && (userQuery.error as { status?: number }).status === 401) {
    clearToken()
  }

  const value: AuthContextValue = {
    user,
    roles,
    permissions,
    isLoading: devLoginLoading || (hasToken && (userQuery.isLoading || permissionsQuery.isLoading)),
    isAuthenticated: hasToken && !!user,
    isPlatformAdmin: user?.isPlatformAdmin ?? false,
    error: userQuery.error ?? permissionsQuery.error ?? null,
    hasPermission,
    hasRole,
    hasAnyRole,
    login,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
