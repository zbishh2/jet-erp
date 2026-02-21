import { Routes, Route, Navigate, Outlet } from "react-router-dom"
import { MainLayout } from "@/components/layout"
import { ErpCustomers, ErpQuotes, ErpQuoteForm, SalesDashboard, SqlExplorer } from "@/pages/erp"
import { Login } from "@/pages/Login"
import { Signup } from "@/pages/Signup"
import { ForgotPassword } from "@/pages/ForgotPassword"
import { useAuth } from "@/contexts/AuthContext"
import { OrgProvider } from "@/contexts/OrgContext"
import { ModuleProvider } from "@/contexts/ModuleContext"
import { isAuthenticated } from "@/lib/auth"

// Protected route wrapper - redirects to login if not authenticated
function ProtectedRoute() {
  const { isLoading } = useAuth()
  const hasToken = isAuthenticated()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (!hasToken) {
    return <Navigate to="/login" replace />
  }

  return (
    <OrgProvider>
      <ModuleProvider>
        <Outlet />
      </ModuleProvider>
    </OrgProvider>
  )
}

// Public route wrapper - redirects to dashboard if already authenticated
function PublicRoute() {
  const hasToken = isAuthenticated()

  if (hasToken) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

function App() {
  return (
    <Routes>
      {/* Public routes (login, signup, etc) */}
      <Route element={<PublicRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
      </Route>

      {/* Protected routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/erp/quotes" replace />} />

          {/* ERP Module Routes */}
          <Route path="/erp/quotes" element={<ErpQuotes />} />
          <Route path="/erp/quotes/new" element={<ErpQuoteForm />} />
          <Route path="/erp/quotes/:id" element={<ErpQuoteForm />} />
          <Route path="/erp/customers" element={<ErpCustomers />} />
          <Route path="/erp/sales" element={<SalesDashboard />} />
          <Route path="/erp/sql-explorer" element={<SqlExplorer />} />
        </Route>
      </Route>

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
