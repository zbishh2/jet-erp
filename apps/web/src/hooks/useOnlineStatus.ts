import { useState, useEffect, useCallback } from "react"

/**
 * Hook to detect online/offline status with debouncing.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  )
  const [wasOffline, setWasOffline] = useState(false)

  const handleOnline = useCallback(() => {
    setIsOnline(true)
    // Track that we came back from offline state
    if (!isOnline) {
      setWasOffline(true)
      // Reset the flag after a short delay to allow components to react
      setTimeout(() => setWasOffline(false), 3000)
    }
  }, [isOnline])

  const handleOffline = useCallback(() => {
    setIsOnline(false)
  }, [])

  useEffect(() => {
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [handleOnline, handleOffline])

  return { isOnline, wasOffline }
}
