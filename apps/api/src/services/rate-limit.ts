import type { Env } from '../types/bindings'

export interface RateLimitConfig {
  maxAttempts: number
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter: number
}

/**
 * Get client IP address from request headers.
 * Trusts CF-Connecting-IP when behind Cloudflare, falls back to X-Forwarded-For.
 */
export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

/**
 * Check and enforce rate limit using KV storage.
 * Returns whether the request is allowed and retry information.
 */
export async function checkRateLimit(
  env: Env,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  // Handle missing RATE_LIMIT KV binding gracefully
  if (!env.RATE_LIMIT) {
    // Fail open in development, fail closed in production
    if (env.ENVIRONMENT === 'production') {
      return { allowed: false, remaining: 0, retryAfter: config.windowSeconds }
    }
    return { allowed: true, remaining: config.maxAttempts, retryAfter: 0 }
  }

  const current = await env.RATE_LIMIT.get(key)
  const count = current ? parseInt(current, 10) : 0

  if (count >= config.maxAttempts) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: config.windowSeconds,
    }
  }

  await env.RATE_LIMIT.put(key, (count + 1).toString(), {
    expirationTtl: config.windowSeconds,
  })

  return {
    allowed: true,
    remaining: config.maxAttempts - count - 1,
    retryAfter: 0,
  }
}

/**
 * Clear a rate limit counter (e.g. after a successful password reset).
 */
export async function clearRateLimit(env: Env, key: string): Promise<void> {
  if (!env.RATE_LIMIT) return
  await env.RATE_LIMIT.delete(key)
}

// Pre-configured rate limits for common use cases
export const AUTH_RATE_LIMITS = {
  login: { maxAttempts: 5, windowSeconds: 15 * 60 } as RateLimitConfig,        // 5 per 15 min per IP
  loginAccount: { maxAttempts: 10, windowSeconds: 30 * 60 } as RateLimitConfig, // 10 per 30 min per email (account lockout)
  signup: { maxAttempts: 10, windowSeconds: 60 * 60 } as RateLimitConfig,     // 10 per hour
  passwordReset: { maxAttempts: 5, windowSeconds: 60 * 60 } as RateLimitConfig, // 5 per hour
  verification: { maxAttempts: 5, windowSeconds: 15 * 60 } as RateLimitConfig, // 5 per 15 min
  inviteValidation: { maxAttempts: 10, windowSeconds: 60 } as RateLimitConfig,  // 10 per minute
  publicSubmission: { maxAttempts: 10, windowSeconds: 60 * 60 } as RateLimitConfig, // 10 per hour
}
