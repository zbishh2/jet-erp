import * as jose from 'jose'

// Entra ID issuer URL templates for multi-tenant apps
const ENTRA_ISSUER_V2 = 'https://login.microsoftonline.com/{tenantId}/v2.0'
const ENTRA_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys'

// KV cache key and TTL
const JWKS_CACHE_KEY = 'jwks:entra'
const JWKS_CACHE_TTL = 3600 // 1 hour in seconds

export interface EntraTokenClaims {
  sub: string           // Subject (user ID within the app)
  oid: string           // Object ID (user's Entra object ID)
  tid: string           // Tenant ID (customer's Entra tenant)
  email?: string        // Email (may be in preferred_username instead)
  preferred_username?: string
  name?: string         // Display name
  roles?: string[]      // App roles from Entra
  aud: string           // Audience (your app's client ID)
  iss: string           // Issuer
  exp: number           // Expiration
  iat: number           // Issued at
}

export interface JwtValidationResult {
  valid: boolean
  claims?: EntraTokenClaims
  error?: string
}

interface CachedJWKS {
  keys: jose.JWK[]
}

/**
 * Get JWKS from KV cache or fetch from Entra
 */
async function getJwks(kv: KVNamespace): Promise<jose.JWTVerifyGetKey> {
  // Try to get from cache first
  const cached = await kv.get<CachedJWKS>(JWKS_CACHE_KEY, { type: 'json' })

  if (cached) {
    // Create a local JWKS from cached keys
    const jwks = jose.createLocalJWKSet({ keys: cached.keys })
    return jwks
  }

  // Fetch from Entra
  const response = await fetch(ENTRA_JWKS_URL)
  if (!response.ok) {
    throw new Error(`Failed to fetch JWKS: ${response.status}`)
  }

  const jwksData = await response.json() as CachedJWKS

  // Cache in KV with TTL
  await kv.put(JWKS_CACHE_KEY, JSON.stringify(jwksData), { expirationTtl: JWKS_CACHE_TTL })

  // Create and return JWKS
  return jose.createLocalJWKSet({ keys: jwksData.keys })
}

/**
 * Validate an Entra ID JWT token
 */
export async function validateEntraToken(
  token: string,
  expectedAudience: string,
  kv: KVNamespace
): Promise<JwtValidationResult> {
  try {
    const jwks = await getJwks(kv)

    const { payload } = await jose.jwtVerify(token, jwks, {
      // Don't validate issuer here - we'll do it manually for multi-tenant
      audience: expectedAudience,
      clockTolerance: 60, // 1 minute clock skew tolerance
    })

    const claims = payload as unknown as EntraTokenClaims

    // Validate required claims
    if (!claims.oid) {
      return { valid: false, error: 'Missing oid claim' }
    }
    if (!claims.tid) {
      return { valid: false, error: 'Missing tid (tenant ID) claim' }
    }

    // Validate issuer format for multi-tenant
    // Accept tokens from any Entra tenant, but verify the issuer matches the tenant ID in the token
    const expectedIssuer = ENTRA_ISSUER_V2.replace('{tenantId}', claims.tid)
    if (claims.iss !== expectedIssuer) {
      // Also accept v1 issuer format
      const expectedIssuerV1 = `https://sts.windows.net/${claims.tid}/`
      if (claims.iss !== expectedIssuerV1) {
        return { valid: false, error: `Invalid issuer: ${claims.iss}` }
      }
    }

    // Extract email from either claim
    const email = claims.email || claims.preferred_username

    return {
      valid: true,
      claims: {
        ...claims,
        email,
      },
    }
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      return { valid: false, error: 'Token expired' }
    }
    if (err instanceof jose.errors.JWTClaimValidationFailed) {
      return { valid: false, error: `Claim validation failed: ${err.message}` }
    }
    if (err instanceof jose.errors.JWSSignatureVerificationFailed) {
      return { valid: false, error: 'Invalid signature' }
    }

    const message = err instanceof Error ? err.message : 'Unknown error'
    return { valid: false, error: `Token validation failed: ${message}` }
  }
}

/**
 * Decode a JWT without validation (for debugging/logging)
 */
export function decodeToken(token: string): EntraTokenClaims | null {
  try {
    const decoded = jose.decodeJwt(token)
    return decoded as unknown as EntraTokenClaims
  } catch {
    return null
  }
}
