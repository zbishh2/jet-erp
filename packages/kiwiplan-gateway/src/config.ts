import 'dotenv/config'

/**
 * Gateway Configuration
 *
 * CRITICAL SAFETY SETTINGS:
 * - devMode: When true, ALL queries are filtered to test company only
 * - testCompanyId: The Kiwiplan company ID used for development/testing
 * - Never run in production mode without explicit approval
 */

export interface GatewayConfig {
  // Server settings
  port: number
  host: string

  // Database connection (ESP)
  db: {
    server: string
    database: string
    user: string
    password: string
    options: {
      encrypt: boolean
      trustServerCertificate: boolean
    }
  }

  // KDW database connection (same server, different database)
  kdwDb: {
    server: string
    database: string
    user: string
    password: string
    options: {
      encrypt: boolean
      trustServerCertificate: boolean
    }
  }

  // Safety settings
  devMode: boolean
  testCompanyId: number | null

  // Authentication
  /**
   * Service token for API authentication.
   * When set, all requests (except /health) must include:
   *   Authorization: Bearer <token>
   *
   * REQUIRED when exposing via Cloudflare Tunnel or public network.
   * Can be omitted for private on-prem deployment.
   */
  serviceToken: string | null

  // Logging
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  logQueries: boolean
}

function getEnvOrThrow(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue
}

export function loadConfig(): GatewayConfig {
  const devMode = process.env.NODE_ENV !== 'production'

  // In dev mode, test company ID is REQUIRED
  const testCompanyId = process.env.TEST_COMPANY_ID
    ? parseInt(process.env.TEST_COMPANY_ID, 10)
    : null

  if (devMode && !testCompanyId) {
    throw new Error(
      'TEST_COMPANY_ID is required in dev mode. ' +
      'Run find-test-company.js to find the test company ID.'
    )
  }

  // Service token for auth (optional for local dev, required in production)
  const serviceToken = process.env.SERVICE_TOKEN || null

  if (!devMode && !serviceToken) {
    throw new Error(
      'SERVICE_TOKEN is required in production. ' +
      'Set SERVICE_TOKEN environment variable to secure the gateway.'
    )
  }

  return {
    port: parseInt(getEnvOrDefault('PORT', '3002'), 10),
    host: getEnvOrDefault('HOST', '127.0.0.1'),

    db: {
      server: getEnvOrThrow('DB_SERVER'),
      database: getEnvOrThrow('DB_DATABASE'),
      user: getEnvOrThrow('DB_USER'),
      password: getEnvOrThrow('DB_PASSWORD'),
      options: {
        encrypt: getEnvOrDefault('DB_ENCRYPT', 'true') === 'true',
        trustServerCertificate: devMode, // Only trust self-signed certs in dev
      },
    },

    kdwDb: {
      server: getEnvOrThrow('DB_SERVER'),
      database: getEnvOrDefault('KDW_DATABASE', 'kdw_master'),
      user: getEnvOrThrow('DB_USER'),
      password: getEnvOrThrow('DB_PASSWORD'),
      options: {
        encrypt: getEnvOrDefault('DB_ENCRYPT', 'true') === 'true',
        trustServerCertificate: devMode, // Only trust self-signed certs in dev
      },
    },

    devMode,
    testCompanyId,
    serviceToken,

    logLevel: (getEnvOrDefault('LOG_LEVEL', 'info') as GatewayConfig['logLevel']),
    logQueries: getEnvOrDefault('LOG_QUERIES', 'true') === 'true',
  }
}

export const config = loadConfig()
