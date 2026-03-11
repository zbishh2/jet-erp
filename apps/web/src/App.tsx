import { Routes, Route, Navigate, Outlet } from "react-router-dom"
import { MainLayout } from "@/components/layout"
import { ErpCustomers, ErpQuotes, ErpQuoteForm, SalesDashboard, SqFtDashboard, ContributionDashboard, CostVarianceDashboard, SqlExplorer, ProductionDashboard, MrpDashboard, UserManagement, PlantTvDashboard, CostAnalysis } from "@/pages/erp"
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

// Role guard component - checks if user has required roles
function RoleGuard({ requiredRoles, children }: { requiredRoles: string[]; children: React.ReactNode }) {
  const { roles, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const userRoles = roles.map(r => String(r))
  const hasAccess = requiredRoles.some(r => userRoles.includes(r))

  if (!hasAccess) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md mx-auto px-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">Access Restricted</h2>
          <p className="text-sm text-foreground-secondary">
            You don't have permission to view this page. Contact your administrator to request access.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

// No access page for users with zero roles
function NoAccessPage() {
  const { roles, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (roles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md mx-auto px-6">
          <h2 className="text-lg font-semibold text-foreground mb-2">No Access</h2>
          <p className="text-sm text-foreground-secondary">
            Your account has been created but you haven't been assigned any roles yet.
            Please contact your administrator to get access.
          </p>
        </div>
      </div>
    )
  }

  // Has roles, redirect to first accessible dashboard
  return <Navigate to="/erp/production" replace />
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
          <Route path="/" element={<NoAccessPage />} />

          {/* Production — any role */}
          <Route path="/erp/production" element={<ProductionDashboard />} />
          <Route path="/erp/sqft" element={<SqFtDashboard />} />
          <Route path="/erp/mrp" element={<MrpDashboard />} />
          <Route path="/erp/plant-tv" element={<PlantTvDashboard />} />

          {/* Estimating — ESTIMATOR or ADMIN */}
          <Route path="/erp/quotes" element={<RoleGuard requiredRoles={["ESTIMATOR", "ADMIN"]}><ErpQuotes /></RoleGuard>} />
          <Route path="/erp/quotes/new" element={<RoleGuard requiredRoles={["ESTIMATOR", "ADMIN"]}><ErpQuoteForm /></RoleGuard>} />
          <Route path="/erp/quotes/:id" element={<RoleGuard requiredRoles={["ESTIMATOR", "ADMIN"]}><ErpQuoteForm /></RoleGuard>} />
          <Route path="/erp/customers" element={<RoleGuard requiredRoles={["ESTIMATOR", "ADMIN"]}><ErpCustomers /></RoleGuard>} />

          {/* Financial — FINANCE or ADMIN */}
          <Route path="/erp/sales" element={<RoleGuard requiredRoles={["FINANCE", "ADMIN"]}><SalesDashboard /></RoleGuard>} />
          <Route path="/erp/contribution" element={<RoleGuard requiredRoles={["FINANCE", "ADMIN"]}><ContributionDashboard /></RoleGuard>} />
          <Route path="/erp/cost-variance" element={<RoleGuard requiredRoles={["FINANCE", "ADMIN"]}><CostVarianceDashboard /></RoleGuard>} />
          <Route path="/erp/cost-analysis" element={<RoleGuard requiredRoles={["FINANCE", "ADMIN"]}><CostAnalysis /></RoleGuard>} />
          <Route path="/erp/invoice-cost-variance" element={<Navigate to="/erp/cost-variance" replace />} />

          {/* Admin — ADMIN only */}
          <Route path="/erp/sql-explorer" element={<RoleGuard requiredRoles={["ADMIN"]}><SqlExplorer /></RoleGuard>} />
          <Route path="/erp/admin/users" element={<RoleGuard requiredRoles={["ADMIN"]}><UserManagement /></RoleGuard>} />
        </Route>
      </Route>

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
