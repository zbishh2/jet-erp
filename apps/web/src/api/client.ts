import { ApiError } from "@/lib/errors"
import { getToken } from "@/lib/auth"

const DEFAULT_API_BASE_URL = "/api"
const ORG_STORAGE_KEY = 'qms_current_org_id'
const MODULE_STORAGE_KEY = 'qms_current_module_code'

// Get current organization ID from localStorage
export function getCurrentOrgId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ORG_STORAGE_KEY)
}

// Set current organization ID in localStorage
export function setCurrentOrgId(orgId: string | null): void {
  if (typeof window === 'undefined') return
  if (orgId) {
    localStorage.setItem(ORG_STORAGE_KEY, orgId)
  } else {
    localStorage.removeItem(ORG_STORAGE_KEY)
  }
}

// Get current module code from localStorage
export function getCurrentModuleCode(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(MODULE_STORAGE_KEY)
}

// Set current module code in localStorage
export function setCurrentModuleCode(moduleCode: string | null): void {
  if (typeof window === 'undefined') return
  if (moduleCode) {
    localStorage.setItem(MODULE_STORAGE_KEY, moduleCode)
  } else {
    localStorage.removeItem(MODULE_STORAGE_KEY)
  }
}

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? DEFAULT_API_BASE_URL

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "")
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`
}

export function buildApiUrl(path: string) {
  const baseUrl = normalizeBaseUrl(API_BASE_URL)
  if (!baseUrl) {
    return normalizePath(path)
  }

  return `${baseUrl}${normalizePath(path)}`
}

async function parseResponseBody(response: Response) {
  const contentType = response.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    return response.json()
  }

  return response.text()
}

interface ApiFetchOptions extends RequestInit {
  skipAuth?: boolean // For auth endpoints that don't need a token
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { skipAuth, ...fetchOptions } = options
  const headers = new Headers(fetchOptions.headers)

  // Only set JSON Content-Type for non-FormData bodies
  if (fetchOptions.body && !headers.has("Content-Type") && !(fetchOptions.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }

  // Add auth token if available and not skipped
  if (!skipAuth) {
    const token = getToken()
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    }
  }

  // Add organization ID header if available
  const orgId = getCurrentOrgId()
  if (orgId) {
    headers.set("X-Organization-Id", orgId)
  }

  // Add module code header if available for module-scoped permissions/authorization
  const moduleCode = getCurrentModuleCode()
  if (moduleCode) {
    headers.set("X-Module-Code", moduleCode)
  }

  let response: Response

  try {
    response = await fetch(buildApiUrl(path), {
      ...fetchOptions,
      headers,
    })
  } catch (error) {
    // Network error (no connection, DNS failure, etc.)
    throw ApiError.fromNetworkError(error instanceof Error ? error : new Error("Network error"))
  }

  const payload = await parseResponseBody(response)

  if (!response.ok) {
    throw await ApiError.fromResponse(response, payload)
  }

  return payload as T
}
