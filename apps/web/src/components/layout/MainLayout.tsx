import { Outlet } from "react-router-dom"
import { Sidebar } from "./Sidebar"
import { useAuth } from "@/contexts/AuthContext"

export function MainLayout() {
  const { isLoading } = useAuth()

  return (
    <div className="flex h-screen bg-background">
      {/* Skip link for keyboard navigation - visible only when focused */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:bg-background focus:px-4 focus:py-2 focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-accent focus:text-blue-600 focus:font-medium"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main id="main-content" className="flex-1 overflow-auto" tabIndex={-1}>
        <div className="px-6 py-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
            </div>
          ) : (
            <Outlet />
          )}
        </div>
      </main>
    </div>
  )
}
