import { Request, Response, NextFunction } from 'express'
import { config } from '../config.js'

/**
 * Service Token Authentication Middleware
 *
 * When SERVICE_TOKEN is configured, all requests must include
 * the token in the Authorization header (Bearer scheme).
 *
 * This is REQUIRED when exposing the gateway via Cloudflare Tunnel
 * or any non-private network.
 *
 * Header format: Authorization: Bearer <token>
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no token is configured (private network mode)
  if (!config.serviceToken) {
    next()
    return
  }

  // Health check is always public (for load balancers, etc.)
  if (req.path === '/health') {
    next()
    return
  }

  const authHeader = req.headers.authorization

  if (!authHeader) {
    console.warn(`[AUTH] Rejected request to ${req.path} - missing Authorization header`)
    res.status(401).json({ error: 'Authorization required' })
    return
  }

  // Expect "Bearer <token>"
  const parts = authHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    console.warn(`[AUTH] Rejected request to ${req.path} - invalid Authorization format`)
    res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' })
    return
  }

  const token = parts[1]

  // Constant-time comparison to prevent timing attacks
  if (!constantTimeEqual(token, config.serviceToken)) {
    console.warn(`[AUTH] Rejected request to ${req.path} - invalid token`)
    res.status(403).json({ error: 'Invalid token' })
    return
  }

  next()
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}
