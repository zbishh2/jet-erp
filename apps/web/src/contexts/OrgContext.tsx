import { createContext, useContext, ReactNode, useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getCurrentOrgId, setCurrentOrgId } from '@/api/client'
import { useAuth } from './AuthContext'

// Organization with modules
interface OrgModule {
  code: string
  name: string
  icon: string | null
  role: string | null
}

interface Organization {
  id: string
  name: string
  slug: string
  isDefault: boolean
  isMember?: boolean // True if user is a member, false if accessing as platform admin
  modules?: OrgModule[]
}

interface OrganizationsResponse {
  data: Organization[]
}

interface OrgContextValue {
  currentOrgId: string | null
  organizations: Organization[]
  currentOrg: Organization | null
  isLoading: boolean
  isSingleOrg: boolean
  switchOrg: (orgId: string) => void
}

const OrgContext = createContext<OrgContextValue | null>(null)

interface OrgProviderProps {
  children: ReactNode
}

export function OrgProvider({ children }: OrgProviderProps) {
  const { isAuthenticated, user } = useAuth()
  const queryClient = useQueryClient()
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(() => getCurrentOrgId())

  // Fetch user's organizations
  const orgsQuery = useQuery({
    queryKey: ['me', 'organizations'],
    queryFn: () => apiFetch<OrganizationsResponse>('/me/organizations'),
    staleTime: 1000 * 60 * 10, // 10 minutes
    retry: false,
    enabled: isAuthenticated,
  })

  const organizations = orgsQuery.data?.data ?? []
  const isSingleOrg = organizations.length <= 1

  // Auto-select org when data loads
  useEffect(() => {
    if (organizations.length > 0 && !currentOrgId) {
      // Find default org, or use first one
      const defaultOrg = organizations.find(o => o.isDefault)
      const orgToSelect = defaultOrg ?? organizations[0]
      setCurrentOrgIdState(orgToSelect.id)
      setCurrentOrgId(orgToSelect.id)
    }
  }, [organizations, currentOrgId])

  // Also check if user response has organizations (from /me endpoint)
  useEffect(() => {
    if (user && !currentOrgId) {
      // User may have organizations from /me response
      const userOrgs = (user as any).organizations as Organization[] | undefined
      if (userOrgs && userOrgs.length > 0) {
        const defaultOrg = userOrgs.find(o => o.isDefault)
        const orgToSelect = defaultOrg ?? userOrgs[0]
        setCurrentOrgIdState(orgToSelect.id)
        setCurrentOrgId(orgToSelect.id)
      }
    }
  }, [user, currentOrgId])

  const switchOrg = useCallback((orgId: string) => {
    // Validate org exists in list
    const org = organizations.find(o => o.id === orgId)
    if (!org) {
      console.error('Cannot switch to org not in list:', orgId)
      return
    }

    // Don't switch if already on this org
    if (orgId === currentOrgId) {
      return
    }

    // Update state and localStorage
    setCurrentOrgIdState(orgId)
    setCurrentOrgId(orgId)

    // Invalidate all queries that depend on org context
    queryClient.invalidateQueries({
      predicate: (query) => {
        // Invalidate most queries except auth-related ones
        const key = query.queryKey[0] as string
        return !['me'].includes(key)
      }
    })

    // Also invalidate permissions since they're org-scoped
    queryClient.invalidateQueries({ queryKey: ['me', 'permissions'] })
    queryClient.invalidateQueries({ queryKey: ['me', 'modules'] })
    queryClient.invalidateQueries({ queryKey: ['me', 'nav-preferences'] })

    // Navigate to home to avoid viewing records from wrong org
    window.location.href = '/'
  }, [organizations, queryClient, currentOrgId])

  const currentOrg = currentOrgId
    ? organizations.find(o => o.id === currentOrgId) ?? null
    : null

  const value: OrgContextValue = {
    currentOrgId,
    organizations,
    currentOrg,
    isLoading: orgsQuery.isLoading,
    isSingleOrg,
    switchOrg,
  }

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext)
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider')
  }
  return context
}

// Hook to check if org context is ready
export function useOrgReady(): boolean {
  const { currentOrgId, isLoading } = useOrg()
  return !isLoading && !!currentOrgId
}
