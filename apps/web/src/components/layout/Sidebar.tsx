import { useEffect, useState } from "react"
import { NavLink, useNavigate } from "react-router-dom"
import {
  LogOut,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeft,
  FileSpreadsheet,
  Factory,
  TrendingUp,
  DollarSign,
  ArrowLeftRight,
  Activity,
  Ruler,
  Package,
  Monitor,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

interface NavGroup {
  label: string
  items: NavItem[]
  requiredRoles?: string[]
}

const navGroups: NavGroup[] = [
  {
    label: "Financial",
    requiredRoles: ["FINANCE", "ADMIN"],
    items: [
      { label: "Sales Dashboard", href: "/erp/sales", icon: TrendingUp },
      { label: "Contribution Dashboard", href: "/erp/contribution", icon: DollarSign },
      { label: "Cost Variance", href: "/erp/cost-variance", icon: ArrowLeftRight },
    ],
  },
  {
    label: "Production",
    items: [
      { label: "OEE Dashboard", href: "/erp/production", icon: Activity },
      { label: "Sq Ft Dashboard", href: "/erp/sqft", icon: Ruler },
      { label: "MRP & Inventory", href: "/erp/mrp", icon: Package },
    ],
  },
  {
    label: "TV Dashboards",
    items: [
      { label: "Sheets/Order Hour", href: "/erp/plant-tv", icon: Monitor },
    ],
  },
  {
    label: "Estimating",
    requiredRoles: ["ESTIMATOR", "ADMIN"],
    items: [
      { label: "Quotes", href: "/erp/quotes", icon: FileSpreadsheet },
      { label: "Customers", href: "/erp/customers", icon: Factory },
    ],
  },
  {
    label: "Admin",
    requiredRoles: ["ADMIN"],
    items: [
      { label: "SQL Explorer", href: "/erp/sql-explorer", icon: Terminal },
      { label: "User Management", href: "/erp/admin/users", icon: Users },
    ],
  },
]

export function Sidebar() {
  const navigate = useNavigate()
  const { user, roles, logout, isLoading } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("sidebar-collapsed")
    return saved === "true"
  })

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", String(collapsed))
  }, [collapsed])

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Filter nav groups by role
  const userRoles = roles.map(r => String(r))
  const visibleGroups = navGroups.filter((group) => {
    if (!group.requiredRoles) return userRoles.length > 0
    return group.requiredRoles.some((r) => userRoles.includes(r))
  })

  const NavItemLink = ({ item }: { item: NavItem }) => {
    const link = (
      <NavLink
        to={item.href}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors",
            collapsed && "justify-center px-0",
            isActive
              ? "bg-background-selected text-foreground"
              : "text-foreground hover:bg-background-hover"
          )
        }
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && item.label}
      </NavLink>
    )

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      )
    }

    return link
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-border bg-background transition-all duration-200",
          collapsed ? "w-14" : "w-64"
        )}
      >
      {/* Header with collapse toggle */}
      <div className={cn("flex items-center border-b border-border", collapsed ? "justify-center p-2" : "justify-between px-3 py-2")}>
        {!collapsed && (
          <p className="px-2 py-1 text-sm font-semibold text-foreground">Jet Container</p>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-1.5 text-foreground-tertiary hover:bg-background-hover hover:text-foreground-secondary"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="sidebar-scroll flex-1 overflow-y-auto px-2 py-4">
        {visibleGroups.map((group, index) => (
          <div key={group.label} className={index === 0 ? "" : "mt-6 pt-2"}>
            {!collapsed && (
              <p className="px-2 mb-2 text-xs font-semibold text-foreground-tertiary tracking-wider">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavItemLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User Menu */}
      <div className="border-t border-border p-2">
        {isLoading ? (
          <div className={cn("flex items-center animate-pulse", collapsed ? "justify-center" : "justify-between")}>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="h-4 w-24 bg-background-hover rounded mb-1" />
                <div className="h-3 w-32 bg-background-hover rounded" />
              </div>
            )}
            <div className="h-8 w-8 bg-background-hover rounded-lg" />
          </div>
        ) : user ? (
          <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "justify-between")}>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.displayName}
                </p>
                <p className="truncate text-xs text-foreground-secondary">{user.email}</p>
              </div>
            )}
            <div className={cn("flex", collapsed ? "flex-col gap-1" : "gap-1")}>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={toggleTheme}
                    className="rounded-lg p-1.5 text-foreground-tertiary hover:bg-background-hover hover:text-foreground-secondary"
                  >
                    {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side={collapsed ? "right" : "top"}>
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </TooltipContent>
              </Tooltip>
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleLogout}
                    className="rounded-lg p-1.5 text-foreground-tertiary hover:bg-background-hover hover:text-foreground-secondary"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side={collapsed ? "right" : "top"}>
                  Sign out
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : null}
      </div>
      </aside>
    </TooltipProvider>
  )
}
