import { WifiOff, Wifi } from "lucide-react"
import { useOnlineStatus } from "@/hooks/useOnlineStatus"

/**
 * Shows a banner when the user is offline or just came back online.
 */
export function OfflineIndicator() {
  const { isOnline, wasOffline } = useOnlineStatus()

  if (isOnline && !wasOffline) {
    return null
  }

  if (!isOnline) {
    return (
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2"
        role="alert"
        aria-live="assertive"
      >
        <WifiOff className="h-4 w-4" aria-hidden="true" />
        <span>You're offline. Some features may be unavailable.</span>
      </div>
    )
  }

  // Just came back online
  if (wasOffline) {
    return (
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-4 duration-300"
        role="status"
        aria-live="polite"
      >
        <Wifi className="h-4 w-4" aria-hidden="true" />
        <span>You're back online!</span>
      </div>
    )
  }

  return null
}
