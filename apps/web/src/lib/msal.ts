import { PublicClientApplication, Configuration, LogLevel, AuthenticationResult } from "@azure/msal-browser"

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID || ""
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000"

/** Microsoft auth is enabled when a real (non-placeholder) client ID is configured */
export const isMicrosoftAuthEnabled = !!clientId && clientId !== PLACEHOLDER

const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: "https://login.microsoftonline.com/common",
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        switch (level) {
          case LogLevel.Error:
            console.error(message)
            break
          case LogLevel.Warning:
            console.warn(message)
            break
        }
      },
    },
  },
}

const msalInstance = new PublicClientApplication(msalConfig)

let cachedRedirectResult: AuthenticationResult | null = null
let resultConsumed = false

/** Initialize MSAL and capture any pending redirect response. Call once before React mounts. */
export async function initializeMsal() {
  if (!isMicrosoftAuthEnabled) return
  await msalInstance.initialize()
  try {
    const response = await msalInstance.handleRedirectPromise()
    if (response) {
      cachedRedirectResult = response
    }
  } catch (error) {
    console.error("Error handling MSAL redirect:", error)
  }
}

/** Get the redirect result (consumed on first read — subsequent calls return null). */
export function getRedirectResult(): AuthenticationResult | null {
  if (resultConsumed) return null
  resultConsumed = true
  return cachedRedirectResult
}

/** Start the Microsoft login redirect flow. Pass optional state (e.g. inviteToken) that survives the redirect. */
export function startMicrosoftLogin(state?: string) {
  msalInstance.loginRedirect({
    scopes: ["openid", "profile", "email"],
    state: state || undefined,
  })
}
