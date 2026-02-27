/**
 * KV-backed caching utility for dashboard queries.
 *
 * Uses the AUTH_CACHE KV namespace with prefixed keys (`dash:...`)
 * to avoid collisions with auth-related cache entries.
 */

/** Default TTLs in seconds */
export const CacheTTL = {
  /** Rarely changes — min date is fixed, max changes on nightly load */
  DATE_LIMITS: 86400, // 24 hours
  /** Dropdown options change infrequently */
  FILTER_OPTIONS: 1800, // 30 minutes
  /** Summary data — balance freshness vs cost */
  DASHBOARD_DATA: 600, // 10 minutes
  /** Lookup data (reps, customers, prices) */
  LOOKUP_DATA: 1800, // 30 minutes
} as const

/**
 * Fetch from KV cache or compute and store.
 *
 * @param kv - KVNamespace (AUTH_CACHE)
 * @param key - Cache key (will be prefixed with `dash:`)
 * @param ttlSeconds - Time-to-live in seconds
 * @param fetcher - Async function to compute value on cache miss
 * @returns The cached or freshly computed value
 */
export async function kvCache<T>(
  kv: KVNamespace,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const fullKey = `dash:${key}`

  try {
    const cached = await kv.get(fullKey, 'json')
    if (cached !== null) {
      return cached as T
    }
  } catch {
    // KV read failed — fall through to fetcher
  }

  const result = await fetcher()

  // Fire-and-forget write — don't block the response
  try {
    kv.put(fullKey, JSON.stringify(result), { expirationTtl: ttlSeconds })
  } catch {
    // KV write failed — non-fatal
  }

  return result
}

/**
 * Build a deterministic cache key from an endpoint name and params.
 */
export function cacheKey(
  prefix: string,
  params: Record<string, string | number | boolean | undefined>
): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
  return parts.length > 0 ? `${prefix}:${parts.join(':')}` : prefix
}
