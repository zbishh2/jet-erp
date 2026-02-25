import { createContext, useContext, ReactNode, useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, getCurrentModuleCode, setCurrentModuleCode } from '@/api/client'
import { useOrg } from './OrgContext'

export interface Module {
  id: string
  code: string
  name: string
  description: string | null
  icon: string | null
  role: string | null
}

interface ModulesResponse {
  data: Module[]
}

// Domain-to-module mapping for product-specific domains
const DOMAIN_MODULE_MAP: Record<string, string> = {
  'app.leangoqms.com': 'qms',
  'app.leangomaintenance.com': 'maintenance',
  'app.leango5s.com': '5s',
}

const DOMAIN_PRODUCT_NAMES: Record<string, string> = {
  qms: 'LeanGo QMS',
  maintenance: 'LeanGo Maintenance',
  '5s': 'LeanGo 5S',
}

function getModuleFromHostname(): string | null {
  const hostname = window.location.hostname
  return DOMAIN_MODULE_MAP[hostname] ?? null
}

interface ModuleContextValue {
  currentModuleCode: string | null
  modules: Module[]
  currentModule: Module | null
  isLoading: boolean
  isSingleModule: boolean
  /** True when the domain locks the app to a single module (e.g., app.leangoqms.com) */
  isDomainLocked: boolean
  /** Product name for domain-locked mode (e.g., "LeanGo QMS") */
  productName: string | null
  /** The module code derived from the hostname, if any */
  domainModuleCode: string | null
  switchModule: (moduleCode: string) => void
}

const ModuleContext = createContext<ModuleContextValue | null>(null)

interface ModuleProviderProps {
  children: ReactNode
}

export function ModuleProvider({ children }: ModuleProviderProps) {
  const { currentOrgId } = useOrg()
  const queryClient = useQueryClient()
  const [currentModuleCode, setCurrentModuleCodeState] = useState<string | null>(() => getCurrentModuleCode())

  // Domain-locking: check if hostname maps to a specific module
  const domainModuleCode = getModuleFromHostname()
  const isDomainLocked = domainModuleCode !== null
  const productName = isDomainLocked ? (DOMAIN_PRODUCT_NAMES[domainModuleCode] ?? null) : null

  // Fetch modules for current org
  const modulesQuery = useQuery({
    queryKey: ['me', 'modules', currentOrgId],
    queryFn: () => apiFetch<ModulesResponse>('/me/modules'),
    staleTime: 1000 * 60 * 10, // 10 minutes
    retry: false,
    enabled: !!currentOrgId,
  })

  const modules = modulesQuery.data?.data ?? []
  const isSingleModule = modules.length <= 1

  // Detect module from URL path
  const getModuleFromPath = useCallback((pathname: string): string | null => {
    if (pathname.startsWith('/qms') || pathname.startsWith('/ncr') || pathname.startsWith('/rca') || pathname.startsWith('/ca')) {
      return 'qms'
    }
    if (pathname.startsWith('/maintenance')) {
      return 'maintenance'
    }
    if (pathname.startsWith('/ci')) {
      return 'ci'
    }
    if (pathname.startsWith('/5s')) {
      return '5s'
    }
    if (pathname.startsWith('/erp')) {
      return 'erp'
    }
    if (pathname.startsWith('/pr')) {
      return 'pr'
    }
    return null
  }, [])

  // Auto-select module when data loads or when org changes
  useEffect(() => {
    if (modules.length > 0) {
      // Domain-locked: always force the domain module
      if (isDomainLocked) {
        const moduleExists = modules.some(m => m.code === domainModuleCode)
        if (moduleExists && currentModuleCode !== domainModuleCode) {
          setCurrentModuleCodeState(domainModuleCode)
          setCurrentModuleCode(domainModuleCode)
        }
        return
      }

      // First, check if URL indicates a specific module
      const urlModule = getModuleFromPath(window.location.pathname)
      if (urlModule && urlModule !== currentModuleCode) {
        const moduleExists = modules.some(m => m.code === urlModule)
        if (moduleExists) {
          setCurrentModuleCodeState(urlModule)
          setCurrentModuleCode(urlModule)
          return
        }
      }

      // Check if current module is still valid for this org
      const currentValid = modules.some(m => m.code === currentModuleCode)

      if (!currentValid) {
        // Select first available module
        const moduleToSelect = modules[0]
        setCurrentModuleCodeState(moduleToSelect.code)
        setCurrentModuleCode(moduleToSelect.code)
      }
    }
  }, [modules, currentModuleCode, getModuleFromPath, isDomainLocked, domainModuleCode])

  // Reset module when org changes
  useEffect(() => {
    if (currentOrgId) {
      // Check if stored module is valid for new org (will be handled by query above)
      // For now, just invalidate the modules query
      queryClient.invalidateQueries({ queryKey: ['me', 'modules'] })
    }
  }, [currentOrgId, queryClient])

  const switchModule = useCallback((moduleCode: string) => {
    // Prevent module switching when domain-locked
    if (isDomainLocked) {
      console.warn('Cannot switch modules on a domain-locked instance')
      return
    }

    // Validate module exists in list
    const mod = modules.find(m => m.code === moduleCode)
    if (!mod) {
      console.error('Cannot switch to module not in list:', moduleCode)
      return
    }

    // Don't switch if already on this module
    if (moduleCode === currentModuleCode) {
      return
    }

    // Update state and localStorage
    setCurrentModuleCodeState(moduleCode)
    setCurrentModuleCode(moduleCode)

    // Invalidate module-specific queries
    queryClient.invalidateQueries({ queryKey: ['me', 'permissions'] })
    queryClient.invalidateQueries({ queryKey: ['me', 'nav-preferences'] })

    // Navigate to module home
    const moduleHomePaths: Record<string, string> = {
      qms: '/qms/ncr',
      maintenance: '/maintenance/work-orders',
      ci: '/ci',
      '5s': '/5s',
      erp: '/erp/quotes',
      pr: '/pr/reports',
    }
    const homePath = moduleHomePaths[moduleCode] || '/'
    window.location.href = homePath
  }, [modules, queryClient, currentModuleCode, isDomainLocked])

  const currentModule = currentModuleCode
    ? modules.find(m => m.code === currentModuleCode) ?? null
    : null

  const value: ModuleContextValue = {
    currentModuleCode,
    modules,
    currentModule,
    isLoading: modulesQuery.isLoading,
    isSingleModule,
    isDomainLocked,
    productName,
    domainModuleCode,
    switchModule,
  }

  return <ModuleContext.Provider value={value}>{children}</ModuleContext.Provider>
}

export function useModule(): ModuleContextValue {
  const context = useContext(ModuleContext)
  if (!context) {
    throw new Error('useModule must be used within a ModuleProvider')
  }
  return context
}

// Hook to check if module context is ready
export function useModuleReady(): boolean {
  const { currentModuleCode, isLoading } = useModule()
  return !isLoading && !!currentModuleCode
}
