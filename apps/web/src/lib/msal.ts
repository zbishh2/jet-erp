import { PublicClientApplication, Configuration, LogLevel, EventType, AuthenticationResult } from "@azure/msal-browser"

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_AZURE_CLIENT_ID || "",
    authority: "https://login.microsoftonline.com/common",
    redirectUri: window.location.origin,
    postLogoutRedirectUri: window.location.origin,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "localStorage",
    storeAuthStateInCookie: true, // Enable for redirect flow
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

export const msalInstance = new PublicClientApplication(msalConfig)

// Track pending redirect callback
let redirectCallbackRegistered = false
let pendingRedirectCallback: ((result: AuthenticationResult) => void) | null = null

export function registerRedirectCallback(callback: (result: AuthenticationResult) => void) {
  pendingRedirectCallback = callback
}

// Initialize MSAL and handle redirect response
export async function initializeMsal() {
  await msalInstance.initialize()

  // Handle redirect response if returning from auth
  if (!redirectCallbackRegistered) {
    redirectCallbackRegistered = true
    msalInstance.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
        const result = event.payload as AuthenticationResult
        if (pendingRedirectCallback && result.idToken) {
          pendingRedirectCallback(result)
        }
      }
    })

    // Check for redirect response
    try {
      const response = await msalInstance.handleRedirectPromise()
      if (response && pendingRedirectCallback) {
        pendingRedirectCallback(response)
      }
    } catch (error) {
      console.error("Error handling redirect:", error)
    }
  }
}

export const loginRequest = {
  scopes: ["openid", "profile", "email"],
}
