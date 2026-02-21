import { Hono } from 'hono'
import { cors } from 'hono/cors'

import type { Env } from './types/bindings'
import { createDb } from './db'
import { healthRoutes } from './routes/health'
import authRoutes from './routes/auth'
import { meRoutes } from './routes/me'
import { erpQuoteRoutes } from './routes/erp-quotes'
import { kiwiplanRoutes } from './routes/kiwiplan'
import { salesDashboardRoutes } from './routes/sales-dashboard'
import { authMiddleware } from './middleware/auth'
import { tenantMiddleware } from './middleware/tenant'
import { moduleContextMiddleware } from './middleware/module-context'
import { requireModuleRolePolicy } from './middleware/require-role'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>().basePath('/api')

  // Global middleware - logger in development
  app.use('*', async (c, next) => {
    if (c.env.ENVIRONMENT !== 'production') {
      const start = Date.now()
      await next()
      const ms = Date.now() - start
      console.log(`${c.req.method} ${c.req.path} - ${c.res.status} (${ms}ms)`)
    } else {
      await next()
    }
  })

  // CORS middleware
  app.use('*', cors({
    origin: (origin, c) => {
      if (!origin) return undefined

      const env = c.env
      const allowlist = (env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((value: string) => value.trim())
        .filter(Boolean)

      const isLocalhost =
        origin.includes('localhost') || origin.includes('127.0.0.1')

      if (env.ENVIRONMENT !== 'production') {
        if (isLocalhost) return origin
      }

      if (allowlist.includes(origin)) {
        return origin
      }

      return undefined
    },
    credentials: true,
  }))

  // Inject bindings into context for all API routes
  app.use('*', async (c, next) => {
    const db = createDb(c.env.DB)
    c.set('db', db)
    c.set('kv', c.env.AUTH_CACHE)
    c.set('r2', c.env.ATTACHMENTS)
    await next()
  })

  // Health check route (no auth required)
  app.route('/health', healthRoutes)

  // Auth routes (public - no auth required)
  app.route('/auth', authRoutes)

  // Me routes (auth required, no tenant context)
  app.use('/me', authMiddleware)
  app.use('/me/*', authMiddleware)
  app.route('/me', meRoutes)

  // ERP module routes (/erp/*)
  app.use('/erp/*', authMiddleware)
  app.use('/erp/*', tenantMiddleware)
  app.use('/erp/*', moduleContextMiddleware('erp'))
  app.use('/erp/*', requireModuleRolePolicy({
    read: ['ADMIN', 'ESTIMATOR', 'VIEWER'],
    write: ['ADMIN', 'ESTIMATOR'],
    del: ['ADMIN'],
  }))

  // Create ERP sub-app and mount routes
  const erpApp = new Hono<{ Bindings: Env }>()
  erpApp.route('/quotes', erpQuoteRoutes)
  erpApp.route('/sales', salesDashboardRoutes)
  erpApp.route('/', kiwiplanRoutes)
  app.route('/erp', erpApp)

  // 404 handler
  app.notFound((c) => {
    return c.json({ error: 'Not Found' }, 404)
  })

  // Error handler
  app.onError((err, c) => {
    console.error('Error:', err)
    return c.json({ error: 'Internal Server Error' }, 500)
  })

  return app
}

// Export the app for Cloudflare Workers
export const app = createApp()
