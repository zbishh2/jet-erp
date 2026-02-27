import type { Database } from '../db'

// Cloudflare Worker bindings
export interface Env {
  // D1 Database
  DB: D1Database

  // KV Namespaces
  AUTH_CACHE: KVNamespace
  RATE_LIMIT: KVNamespace

  // R2 Bucket
  ATTACHMENTS: R2Bucket

  // Environment variables
  ENVIRONMENT: string
  ALLOW_DEV_AUTH?: string
  CORS_ALLOWED_ORIGINS?: string
  AZURE_CLIENT_ID?: string
  AZURE_AD_CLIENT_ID?: string // Legacy
  AZURE_AD_TENANT_ID?: string
  RESEND_API_KEY?: string

  // Kiwiplan Gateway
  KIWIPLAN_GATEWAY_URL?: string
  KIWIPLAN_SERVICE_TOKEN?: string

  // AI Chat
  ANTHROPIC_API_KEY?: string
}

// Extended context variables available in Hono
export interface AppVariables {
  db: Database
  kv: KVNamespace
  r2: R2Bucket
}
