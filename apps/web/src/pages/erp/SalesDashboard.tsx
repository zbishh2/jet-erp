import { useState, useMemo, useCallback, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
  Cell,
  ReferenceArea,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  RotateCcw,
} from "lucide-react"
import {
  useSalesSummary,
  useSalesByRep,
  useSalesByCustomer,
  useSalesReps,
  useSalesBudgets,
  useHolidays,
} from "@/api/hooks/useSalesDashboard"
import type { SalesByCustomer, SalesByRep, Granularity } from "@/api/hooks/useSalesDashboard"

function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `sales-dash:${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored !== null ? JSON.parse(stored) : defaultValue
    } catch {
      return defaultValue
    }
  })
  const setPersisted = useCallback((val: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof val === "function" ? (val as (prev: T) => T)(prev) : val
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }, [storageKey])
  return [value, setPersisted]
}

type TimePeriod = "ytd" | "last-year" | "this-month" | "custom"
type Quarter = "all" | "Q1" | "Q2" | "Q3" | "Q4"

const QUARTER_MONTHS: Record<string, number[]> = {
  Q1: [1, 2, 3],
  Q2: [4, 5, 6],
  Q3: [7, 8, 9],
  Q4: [10, 11, 12],
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`
  }
  if (Math.abs(value) >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K`
  }
  return `$${value.toFixed(0)}`
}

function formatCurrencyFull(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function getDateRange(period: TimePeriod, year: number): { startDate: string; endDate: string } {
  const now = new Date()
  const currentYear = now.getFullYear()
  switch (period) {
    case "ytd":
      return {
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-${String(now.getMonth() + 2).padStart(2, "0")}-01`,
      }
    case "last-year":
      return {
        startDate: `${currentYear - 1}-01-01`,
        endDate: `${currentYear}-01-01`,
      }
    case "this-month": {
      const nextMonth = now.getMonth() + 2
      const nextYear = nextMonth > 12 ? currentYear + 1 : currentYear
      return {
        startDate: `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
        endDate: `${nextYear}-${String(nextMonth > 12 ? 1 : nextMonth).padStart(2, "0")}-01`,
      }
    }
    case "custom":
      return {
        startDate: `${year}-01-01`,
        endDate: `${year + 1}-01-01`,
      }
  }
}

function getPeriodLabel(period: string, granularity: string): string {
  if (granularity === "yearly") return period // "2025"
  if (granularity === "weekly") {
    // period is "2025-03-10" → "Mar 10"
    const [, mm, dd] = period.split("-")
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${months[parseInt(mm, 10) - 1]} ${parseInt(dd, 10)}`
  }
  // monthly: "2025-03" → "Mar"
  const [, mm] = period.split("-")
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return months[parseInt(mm, 10) - 1] || period
}

interface KpiCardProps {
  title: string
  value: string
  description?: string
  trend?: { value: number; isPositive: boolean }
}

function KpiCard({ title, value, description, trend }: KpiCardProps) {
  return (
    <Card className="bg-background-secondary">
      <CardContent className="p-4 h-full flex flex-col items-center justify-center text-center">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold">{value}</p>
          {trend && (
            <span className={`flex items-center text-sm font-medium ${trend.isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {trend.isPositive ? <TrendingUp className="h-4 w-4 mr-0.5" /> : <TrendingDown className="h-4 w-4 mr-0.5" />}
              {Math.abs(trend.value)}%
            </span>
          )}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function SalesDashboard() {
  const navigate = useNavigate()
  const currentYear = new Date().getFullYear()
  const [period, setPeriod] = usePersistedState<TimePeriod>("period", "custom")
  const [year, setYear] = usePersistedState<number>("year", currentYear)
  const [quarter, setQuarter] = usePersistedState<Quarter>("quarter", "all")
  const [repFilter, setRepFilter] = usePersistedState<string>("repFilter", "all")
  const [customerSort, setCustomerSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("customerSort", { key: "totalSales", dir: "desc" })
  const [chartMode, setChartMode] = usePersistedState<"budget" | "yoy">("chartMode", "budget")
  const [granularity, setGranularity] = usePersistedState<Granularity>("granularity", "monthly")
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)

  // Clear selected month when major filters change so it doesn't go stale
  useEffect(() => {
    setSelectedMonth(null)
  }, [period, year, quarter, granularity])

  const { startDate, endDate } = getDateRange(period, year)
  const budgetYear = period === "last-year" ? String(year - 1) : String(year)

  // Prior year date range for YOY
  const priorYearStart = useMemo(() => {
    const d = new Date(startDate)
    return `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  }, [startDate])
  const priorYearEnd = useMemo(() => {
    const d = new Date(endDate)
    return `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  }, [endDate])

  // For yearly granularity, widen the date range to 5 years
  const summaryStart = granularity === "yearly" ? `${currentYear - 4}-01-01` : startDate
  const summaryEnd = granularity === "yearly" ? `${currentYear + 1}-01-01` : endDate

  const activeRep = repFilter !== "all" ? repFilter : undefined

  // Narrow date range when a period is selected (for rep + customer queries)
  const [detailStart, detailEnd] = useMemo(() => {
    if (!selectedMonth) return [startDate, endDate]
    if (granularity === "yearly") {
      return [`${selectedMonth}-01-01`, `${parseInt(selectedMonth) + 1}-01-01`]
    }
    if (granularity === "weekly") {
      // selectedMonth is a Monday like "2026-01-05", range is that week
      const d = new Date(selectedMonth)
      const end = new Date(d)
      end.setDate(end.getDate() + 7)
      return [d.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
    }
    // monthly: "2026-01" → "2026-01-01" to "2026-02-01"
    const [y, m] = selectedMonth.split("-").map(Number)
    const nextMonth = m === 12 ? 1 : m + 1
    const nextYear = m === 12 ? y + 1 : y
    return [`${y}-${String(m).padStart(2, "0")}-01`, `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`]
  }, [selectedMonth, startDate, endDate, granularity])

  const summaryQuery = useSalesSummary(summaryStart, summaryEnd, granularity, activeRep)
  const priorYearQuery = useSalesSummary(priorYearStart, priorYearEnd, granularity, activeRep)
  const byRepQuery = useSalesByRep(detailStart, detailEnd)
  const byCustomerQuery = useSalesByCustomer(detailStart, detailEnd, 9999)
  const repsQuery = useSalesReps()
  const budgetsQuery = useSalesBudgets(budgetYear)
  const holidaysQuery = useHolidays(startDate, endDate)
  const holidayDates = useMemo(() => {
    const set = new Set<string>()
    for (const h of holidaysQuery.data?.data ?? []) set.add(h.holidayDate)
    return set
  }, [holidaysQuery.data])

  const summaryData = summaryQuery.data?.data ?? []
  const priorYearData = priorYearQuery.data?.data ?? []

  // Build prior year lookup: period suffix -> data
  // Monthly: "01","02"  Weekly: full date  Yearly: "2024"
  const priorYearByPeriod = useMemo(() => {
    const map = new Map<string, { totalSales: number; totalMSF: number; totalCost: number }>()
    for (const m of priorYearData) {
      // For monthly, key by month number; for weekly, key by week-of-year offset; for yearly, key by year
      let key: string
      if (granularity === "monthly") {
        key = m.period.split("-")[1] // "01", "02"
      } else if (granularity === "yearly") {
        key = m.period // "2024"
      } else {
        // Weekly — match by week offset from start of year
        key = m.period
      }
      map.set(key, { totalSales: m.totalSales, totalMSF: m.totalMSF, totalCost: m.totalCost })
    }
    return map
  }, [priorYearData, granularity])
  const repData = byRepQuery.data?.data ?? []
  const customerData = byCustomerQuery.data?.data ?? []
  const reps = repsQuery.data?.data ?? []
  const budgets = budgetsQuery.data?.data ?? []

  // Build budget lookup keyed by period
  const budgetByPeriod = useMemo(() => {
    // First build monthly budgets (always from raw data)
    const monthlyMap = new Map<string, { dollars: number; msf: number; contribution: number }>()
    for (const b of budgets) {
      const monthKey = b.month.substring(0, 7) // 'YYYY-MM'
      if (repFilter !== "all" && b.salesRep !== repFilter) continue
      const existing = monthlyMap.get(monthKey) || { dollars: 0, msf: 0, contribution: 0 }
      existing.dollars += b.budgetedDollars
      existing.msf += b.budgetedMsf
      existing.contribution += b.budgetedContribution
      monthlyMap.set(monthKey, existing)
    }

    if (granularity === "monthly") return monthlyMap

    if (granularity === "yearly") {
      // Aggregate monthly budgets into yearly
      const yearlyMap = new Map<string, { dollars: number; msf: number; contribution: number }>()
      for (const [monthKey, val] of monthlyMap) {
        const yearKey = monthKey.split("-")[0]
        const existing = yearlyMap.get(yearKey) || { dollars: 0, msf: 0, contribution: 0 }
        existing.dollars += val.dollars
        existing.msf += val.msf
        existing.contribution += val.contribution
        yearlyMap.set(yearKey, existing)
      }
      return yearlyMap
    }

    // Weekly — prorate: distribute each month's budget across its weeks
    // For simplicity, divide monthly budget by ~4.33 and assign to weeks in that month
    const weeklyMap = new Map<string, { dollars: number; msf: number; contribution: number }>()
    for (const [monthKey, val] of monthlyMap) {
      const [y, m] = monthKey.split("-").map(Number)
      const firstDay = new Date(y, m - 1, 1)
      const lastDay = new Date(y, m, 0)
      // Find all Mondays in this month
      const mondays: string[] = []
      const d = new Date(firstDay)
      // Go to first Monday
      while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
      while (d <= lastDay) {
        mondays.push(d.toISOString().slice(0, 10))
        d.setDate(d.getDate() + 7)
      }
      if (mondays.length === 0) continue
      const perWeek = { dollars: val.dollars / mondays.length, msf: val.msf / mondays.length, contribution: val.contribution / mondays.length }
      for (const monday of mondays) {
        const existing = weeklyMap.get(monday) || { dollars: 0, msf: 0, contribution: 0 }
        existing.dollars += perWeek.dollars
        existing.msf += perWeek.msf
        existing.contribution += perWeek.contribution
        weeklyMap.set(monday, existing)
      }
    }
    return weeklyMap
  }, [budgets, repFilter, granularity])

  // Build budget lookup: rep -> total budgeted dollars (filtered by selected period)
  const budgetByRep = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of budgets) {
      // Filter by selected period if one is active
      if (selectedMonth) {
        const bMonth = b.month.substring(0, 7) // "YYYY-MM"
        if (granularity === "monthly" && bMonth !== selectedMonth) continue
        if (granularity === "yearly" && !bMonth.startsWith(selectedMonth)) continue
        if (granularity === "weekly") {
          // selectedMonth is a Monday date like "2026-01-05" — only include that month's budget, prorated
          const weekMonth = selectedMonth.substring(0, 7)
          if (bMonth !== weekMonth) continue
        }
      }
      const rep = b.salesRep
      map.set(rep, (map.get(rep) || 0) + b.budgetedDollars)
    }
    // For weekly with a selected period, prorate: divide by weeks in that month
    if (selectedMonth && granularity === "weekly") {
      const [y, m] = selectedMonth.substring(0, 7).split("-").map(Number)
      const lastDay = new Date(y, m, 0)
      const d = new Date(y, m - 1, 1)
      while (d.getDay() !== 1) d.setDate(d.getDate() + 1)
      let mondays = 0
      while (d <= lastDay) { mondays++; d.setDate(d.getDate() + 7) }
      if (mondays > 0) {
        for (const [rep, val] of map) map.set(rep, val / mondays)
      }
    }
    return map
  }, [budgets, selectedMonth, granularity])

  // Filter summary data by quarter (only applies to monthly/weekly)
  const filteredSummary = useMemo(() => {
    if (quarter === "all" || granularity === "yearly") return summaryData
    const allowedMonths = QUARTER_MONTHS[quarter]
    return summaryData.filter((m) => {
      if (granularity === "monthly") {
        const monthNum = parseInt(m.period.split("-")[1], 10)
        return allowedMonths.includes(monthNum)
      }
      // Weekly — period is a date like "2025-03-10", extract month
      const monthNum = parseInt(m.period.split("-")[1], 10)
      return allowedMonths.includes(monthNum)
    })
  }, [summaryData, quarter, granularity])

  // Combined chart data (sales + budget + prior year)
  const chartData = useMemo(() => {
    return filteredSummary.map((m) => {
      const budget = budgetByPeriod.get(m.period)
      const contribution = m.totalSales - m.totalCost
      const salesPerMSF = m.totalMSF > 0 ? m.totalSales / m.totalMSF : 0
      const bMSF = budget?.msf ?? 0
      const bDollars = budget?.dollars ?? 0
      const budgetPerMSF = bMSF > 0 ? bDollars / bMSF : 0

      // Prior year data
      let pyKey: string
      if (granularity === "monthly") {
        pyKey = m.period.split("-")[1] // "01"
      } else if (granularity === "yearly") {
        pyKey = String(parseInt(m.period) - 1) // "2024"
      } else {
        // Weekly — shift date back 1 year
        const d = new Date(m.period)
        d.setFullYear(d.getFullYear() - 1)
        pyKey = d.toISOString().slice(0, 10)
      }
      const py = priorYearByPeriod.get(pyKey)
      const pySales = py?.totalSales ?? 0
      const pyMSF = py?.totalMSF ?? 0
      const pyCost = py?.totalCost ?? 0
      const pyContribution = pySales - pyCost
      const pyPerMSF = pyMSF > 0 ? pySales / pyMSF : 0

      return {
        label: getPeriodLabel(m.period, granularity),
        periodKey: m.period,
        totalSales: m.totalSales,
        budget: bDollars,
        budgetMSF: bMSF,
        budgetContribution: budget?.contribution ?? 0,
        budgetPerMSF,
        contribution,
        totalMSF: m.totalMSF,
        totalCost: m.totalCost,
        salesPerMSF,
        invoiceCount: m.invoiceCount,
        pySales,
        pyMSF,
        pyContribution,
        pyPerMSF,
      }
    })
  }, [filteredSummary, budgetByPeriod, priorYearByPeriod, granularity])

  // KPI calculations (react to selectedMonth)
  const kpis = useMemo(() => {
    const periods = selectedMonth
      ? filteredSummary.filter((m) => m.period === selectedMonth)
      : filteredSummary
    const totalSales = periods.reduce((sum, m) => sum + m.totalSales, 0)
    const totalMSF = periods.reduce((sum, m) => sum + m.totalMSF, 0)
    const totalCost = periods.reduce((sum, m) => sum + m.totalCost, 0)
    const contribution = totalSales - totalCost
    const contributionPct = totalSales > 0 ? (contribution / totalSales) * 100 : 0
    const salesPerMSF = totalMSF > 0 ? totalSales / totalMSF : 0

    // Budget totals
    let budgetDollars = 0
    let budgetMSF = 0
    let budgetContribution = 0
    if (selectedMonth) {
      const b = budgetByPeriod.get(selectedMonth)
      if (b) { budgetDollars = b.dollars; budgetMSF = b.msf; budgetContribution = b.contribution }
    } else {
      for (const [, val] of budgetByPeriod) {
        budgetDollars += val.dollars
        budgetMSF += val.msf
        budgetContribution += val.contribution
      }
    }

    // Projected annual (extrapolate from periods with data)
    const periodsWithData = filteredSummary.length
    const projectedAnnual = periodsWithData > 0 ? (totalSales / periodsWithData) * 12 : 0

    // Work days calculation — scoped to detail range (selected period or full range)
    const wdStart = new Date(detailStart)
    const wdEnd = new Date(detailEnd)
    const today = new Date()
    const countNetWorkDays = (from: Date, to: Date) => {
      let count = 0
      const d = new Date(from)
      while (d < to) {
        const day = d.getDay()
        if (day !== 0 && day !== 6) {
          const iso = d.toISOString().slice(0, 10)
          if (!holidayDates.has(iso)) count++
        }
        d.setDate(d.getDate() + 1)
      }
      return count
    }
    const totalWorkDays = countNetWorkDays(wdStart, wdEnd)
    const elapsed = today < wdEnd ? today : wdEnd
    const daysCompleted = countNetWorkDays(wdStart, elapsed)
    const salesPerDay = daysCompleted > 0 ? totalSales / daysCompleted : 0
    const remainingDays = totalWorkDays - daysCompleted
    const remainingSales = budgetDollars - totalSales
    const salesPerDayNeeded = remainingDays > 0 ? Math.max(0, remainingSales / remainingDays) : 0

    // Months elapsed for projected monthly
    const monthsElapsed = Math.max(1, (elapsed.getFullYear() - wdStart.getFullYear()) * 12 + (elapsed.getMonth() - wdStart.getMonth()) + (elapsed.getDate() > 1 ? 1 : 0))
    const projectedMonthlySales = totalSales / monthsElapsed
    const projectedMonthlyCont = contribution / monthsElapsed
    const projectedMonthlyMSF = totalMSF / monthsElapsed

    // Derived per-MSF metrics
    const budgetedPerMSF = budgetMSF > 0 ? budgetDollars / budgetMSF : 0
    const budgetedContPerMSF = budgetMSF > 0 ? budgetContribution / budgetMSF : 0
    const contPerMSF = totalMSF > 0 ? contribution / totalMSF : 0

    return {
      totalSales,
      totalMSF,
      contribution,
      contributionPct,
      salesPerMSF,
      projectedAnnual,
      budgetDollars,
      budgetMSF,
      budgetContribution,
      toBudgetPct: budgetDollars > 0 ? (totalSales / budgetDollars) * 100 : 0,
      totalWorkDays,
      daysCompleted,
      salesPerDay,
      salesPerDayNeeded,
      projectedMonthlySales,
      projectedMonthlyCont,
      projectedMonthlyMSF,
      budgetedPerMSF,
      budgetedContPerMSF,
      contPerMSF,
      contToBudgetPct: budgetContribution > 0 ? (contribution / budgetContribution) * 100 : 0,
      msfToBudgetPct: budgetMSF > 0 ? (totalMSF / budgetMSF) * 100 : 0,
      perMsfToBudgetPct: budgetedPerMSF > 0 ? (salesPerMSF / budgetedPerMSF) * 100 : 0,
      contPerMsfToBudgetPct: budgetedContPerMSF > 0 ? (contPerMSF / budgetedContPerMSF) * 100 : 0,
    }
  }, [filteredSummary, budgetByPeriod, selectedMonth, detailStart, detailEnd, holidayDates])

  // Filter customer data by rep
  const filteredCustomerData = useMemo(() => {
    let data = customerData
    if (repFilter !== "all") {
      data = data.filter((c) => c.repName === repFilter)
    }
    // Sort
    const key = customerSort.key as keyof SalesByCustomer
    return [...data].sort((a, b) => {
      const aVal = a[key] ?? 0
      const bVal = b[key] ?? 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        return customerSort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      return customerSort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
  }, [customerData, repFilter, customerSort])

  // Rep table data (sorted)
  const [repSort, setRepSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("repSort", { key: "totalSales", dir: "desc" })
  const [tableTab, setTableTab] = usePersistedState<"customer" | "rep" | "budget">("tableTab", "customer")

  const sortedRepData = useMemo(() => {
    const key = repSort.key as keyof SalesByRep
    return [...repData].sort((a, b) => {
      const aVal = a[key] ?? 0
      const bVal = b[key] ?? 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        return repSort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      return repSort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
  }, [repData, repSort])

  const handleRepSort = (key: string) => {
    setRepSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }))
  }

  // Area chart click handler — toggle period filter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = useCallback((data: any) => {
    // Try activePayload first (click near a data point)
    let periodKey = data?.activePayload?.[0]?.payload?.periodKey as string | undefined
    // Fallback: match activeLabel back to chartData
    if (!periodKey && data?.activeLabel) {
      const match = chartData.find((d) => d.label === data.activeLabel)
      if (match) periodKey = match.periodKey
    }
    if (!periodKey) return
    setSelectedMonth((prev) => (prev === periodKey ? null : periodKey))
  }, [chartData])

  const handleCustomerSort = (key: string) => {
    setCustomerSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }))
  }

  const resetFilters = useCallback(() => {
    setPeriod("custom")
    setYear(currentYear)
    setQuarter("all")
    setRepFilter("all")
    setChartMode("budget")
    setGranularity("monthly")
    setSelectedMonth(null)
    setCustomerSort({ key: "totalSales", dir: "desc" })
    setRepSort({ key: "totalSales", dir: "desc" })
    setTableTab("customer")
  }, [currentYear, setPeriod, setYear, setQuarter, setRepFilter, setChartMode, setGranularity, setCustomerSort, setRepSort, setTableTab])

  // Rep bar chart data
  const repBarData = useMemo(() => repData.map((r) => ({
    name: r.repName || "Unassigned",
    actual: r.totalSales,
    budget: budgetByRep.get(r.repName || "") ?? 0,
  })), [repData, budgetByRep])

  const repBarHeight = Math.max(200, repBarData.length * 34)

  // Grey-out regions for non-selected periods on area chart
  const dimRegions = useMemo(() => {
    if (!selectedMonth || chartData.length === 0) return null
    const idx = chartData.findIndex((d) => d.periodKey === selectedMonth)
    if (idx < 0) return null
    const labels = chartData.map((d) => d.label)
    const left = idx > 0 ? { x1: labels[0], x2: labels[idx - 1] } : null
    const right = idx < labels.length - 1 ? { x1: labels[idx + 1], x2: labels[labels.length - 1] } : null
    return { left, right }
  }, [selectedMonth, chartData])

  // Smart area chart label — shifts first label right, last label left
  const renderAreaLabel = useCallback((formatter: (v: number) => string) => {
    const total = chartData.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (props: any) => {
      const { x, y, value, index } = props
      const anchor = index === 0 ? "start" : index === total - 1 ? "end" : "middle"
      return (
        <text x={x} y={y - 10} fill="#e2e8f0" fontSize={11} textAnchor={anchor}>
          {formatter(value)}
        </text>
      )
    }
  }, [chartData.length])

  const chartLoading = summaryQuery.isLoading || priorYearQuery.isLoading
  const repLoading = byRepQuery.isLoading
  const isLoading = chartLoading || repLoading || byCustomerQuery.isLoading

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 -mx-6 -mt-6 pt-3 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate("/erp")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">Sales Dashboard</span>
        <div className="flex items-center gap-1 ml-2">
          {(["all", "Q1", "Q2", "Q3", "Q4"] as Quarter[]).map((q) => (
            <Button
              key={q}
              variant={quarter === q ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setQuarter(q)}
            >
              {q === "all" ? "All" : q}
            </Button>
          ))}
          {selectedMonth && (
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5 text-xs ml-1"
              onClick={() => setSelectedMonth(null)}
            >
              {getPeriodLabel(selectedMonth, granularity)} ✕
            </Button>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={repFilter} onValueChange={setRepFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue placeholder="All Reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {reps.map((r) => (
                <SelectItem key={r.contactId} value={r.repName}>
                  {r.repName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={period} onValueChange={(v) => setPeriod(v as TimePeriod)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ytd">YTD</SelectItem>
              <SelectItem value="this-month">This Month</SelectItem>
              <SelectItem value="last-year">Last Year</SelectItem>
              <SelectItem value="custom">Full Year</SelectItem>
            </SelectContent>
          </Select>

          {period === "custom" && (
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-[90px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetFilters} title="Reset filters">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          title="Total Sales"
          value={formatCurrency(kpis.totalSales)}
          description={kpis.budgetDollars > 0 ? `${formatPercent(kpis.toBudgetPct)} to budget` : undefined}
        />
        <KpiCard
          title="Contribution $"
          value={formatCurrency(kpis.contribution)}
        />
        <KpiCard
          title="Contribution %"
          value={formatPercent(kpis.contributionPct)}
        />
        <KpiCard
          title="MSF"
          value={formatNumber(kpis.totalMSF, 0)}
        />
        <KpiCard
          title="Sales $/MSF"
          value={`$${formatNumber(kpis.salesPerMSF, 2)}`}
        />
        <KpiCard
          title="Projected Annual"
          value={formatCurrency(kpis.projectedAnnual)}
        />
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Monthly Actual vs Budget — Tabbed Area Chart */}
        <Card className="lg:col-span-2 bg-background-secondary">
          <Tabs defaultValue="sales">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <Button
                      variant={chartMode === "budget" ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setChartMode("budget")}
                    >
                      Actual vs Budget
                    </Button>
                    <Button
                      variant={chartMode === "yoy" ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setChartMode("yoy")}
                    >
                      YOY
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    {(["yearly", "monthly", "weekly"] as Granularity[]).map((g) => (
                      <Button
                        key={g}
                        variant={granularity === g ? "default" : "outline"}
                        size="sm"
                        className="h-7 w-7 px-0 text-xs"
                        onClick={() => setGranularity(g)}
                      >
                        {g[0].toUpperCase()}
                      </Button>
                    ))}
                  </div>
                </div>
                <TabsList>
                  <TabsTrigger value="sales">Sales</TabsTrigger>
                  <TabsTrigger value="msf">MSF</TabsTrigger>
                  <TabsTrigger value="contribution">Contribution</TabsTrigger>
                  <TabsTrigger value="permsf">$/MSF</TabsTrigger>
                </TabsList>
              </div>
            </CardHeader>
            <CardContent>
              {chartLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (() => {
                const compLabel = chartMode === "yoy" ? "Prior Year" : "Budget"
                const compSales = chartMode === "yoy" ? "pySales" : "budget"
                const compMSF = chartMode === "yoy" ? "pyMSF" : "budgetMSF"
                const compContribution = chartMode === "yoy" ? "pyContribution" : "budgetContribution"
                const compPerMSF = chartMode === "yoy" ? "pyPerMSF" : "budgetPerMSF"
                return (
                <>
                  <TabsContent value="sales" className="mt-0">
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                        <defs>
                          <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="gradBudget" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" tickLine={false} />
                        <YAxis tickFormatter={(v) => formatCurrency(v)} className="text-xs" />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [formatCurrencyFull(value), name]) as any}
                          contentStyle={{ backgroundColor: "#1a1a2e", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compSales} name={compLabel} stroke="#a78bfa" fill="url(#gradBudget)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="totalSales" name="Actual" stroke="#6366f1" fill="url(#gradActual)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false}>
                          <LabelList dataKey="totalSales" content={renderAreaLabel(formatCurrency)} />
                        </Area>
                      </AreaChart>
                    </ResponsiveContainer>
                  </TabsContent>
                  <TabsContent value="msf" className="mt-0">
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                        <defs>
                          <linearGradient id="gradActualMSF" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="gradBudgetMSF" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" tickLine={false} />
                        <YAxis tickFormatter={(v) => formatNumber(v, 0)} className="text-xs" />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [formatNumber(value, 0), name]) as any}
                          contentStyle={{ backgroundColor: "#1a1a2e", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compMSF} name={compLabel} stroke="#a78bfa" fill="url(#gradBudgetMSF)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="totalMSF" name="Actual" stroke="#6366f1" fill="url(#gradActualMSF)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false}>
                          <LabelList dataKey="totalMSF" content={renderAreaLabel((v) => formatNumber(v, 0))} />
                        </Area>
                      </AreaChart>
                    </ResponsiveContainer>
                  </TabsContent>
                  <TabsContent value="contribution" className="mt-0">
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                        <defs>
                          <linearGradient id="gradActualCont" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="gradBudgetCont" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" tickLine={false} />
                        <YAxis tickFormatter={(v) => formatCurrency(v)} className="text-xs" />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [formatCurrencyFull(value), name]) as any}
                          contentStyle={{ backgroundColor: "#1a1a2e", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compContribution} name={compLabel} stroke="#a78bfa" fill="url(#gradBudgetCont)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="contribution" name="Actual" stroke="#6366f1" fill="url(#gradActualCont)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false}>
                          <LabelList dataKey="contribution" content={renderAreaLabel(formatCurrency)} />
                        </Area>
                      </AreaChart>
                    </ResponsiveContainer>
                  </TabsContent>
                  <TabsContent value="permsf" className="mt-0">
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                        <defs>
                          <linearGradient id="gradActualPMSF" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id="gradBudgetPMSF" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" tickLine={false} />
                        <YAxis tickFormatter={(v) => `$${formatNumber(v, 2)}`} className="text-xs" />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [`$${formatNumber(value, 2)}`, name]) as any}
                          contentStyle={{ backgroundColor: "#1a1a2e", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compPerMSF} name={compLabel} stroke="#a78bfa" fill="url(#gradBudgetPMSF)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="salesPerMSF" name="Actual" stroke="#6366f1" fill="url(#gradActualPMSF)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false}>
                          <LabelList dataKey="salesPerMSF" content={renderAreaLabel((v) => `$${formatNumber(v, 2)}`)} />
                        </Area>
                      </AreaChart>
                    </ResponsiveContainer>
                  </TabsContent>
                </>
                )
              })()}
            </CardContent>
          </Tabs>
        </Card>

        {/* Sales by Rep — Stacked Actual vs Budget */}
        <Card className="bg-background-secondary">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Sales by Rep</CardTitle>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />Actual</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#a78bfa]" />Budget</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {repLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <div className="px-4 pb-4">
                <div
                  className="overflow-y-auto overflow-x-hidden max-h-[250px] cursor-pointer"
                  onClick={(e) => {
                    const wrapper = e.currentTarget.querySelector('.recharts-wrapper') as HTMLElement
                    if (!wrapper) return
                    const rect = wrapper.getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const topPad = 5
                    const chartH = rect.height - topPad - 5
                    const rowH = chartH / repBarData.length
                    const idx = Math.floor((y - topPad) / rowH)
                    if (idx >= 0 && idx < repBarData.length) {
                      const name = repBarData[idx].name
                      setRepFilter((prev) => (prev === name ? "all" : name))
                    }
                  }}
                >
                  <ResponsiveContainer width="100%" height={repBarHeight}>
                    <BarChart data={repBarData} layout="vertical" margin={{ left: 10, right: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fontSize: 11 }} />
                      <RechartsTooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={((value: number, name: string) => [formatCurrencyFull(value), name]) as any}
                        contentStyle={{ backgroundColor: "#1a1a2e", borderColor: "var(--border)", borderRadius: 8 }}
                        labelStyle={{ color: "#e2e8f0", fontWeight: 600 }}
                          itemStyle={{ color: "#e2e8f0" }}
                        cursor={{ fill: "rgba(255,255,255,0.05)" }}
                      />
                      <Bar dataKey="budget" name="Budget" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                        {repBarData.map((d, i) => (
                          <Cell key={i} fill={repFilter !== "all" && d.name !== repFilter ? "#a78bfa33" : "#a78bfa"} />
                        ))}
                      </Bar>
                      <Bar dataKey="actual" name="Actual" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                        {repBarData.map((d, i) => (
                          <Cell key={i} fill={repFilter !== "all" && d.name !== repFilter ? "#6366f133" : "#6366f1"} />
                        ))}
                        <LabelList dataKey="actual" position="right" fill="#e2e8f0" fontSize={11} formatter={((v: number) => formatCurrency(v)) as any} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sales Detail Table — Tabbed Customer / Rep */}
      <Card className="bg-background-secondary">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Sales Detail</CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant={tableTab === "customer" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setTableTab("customer")}
              >
                By Customer
              </Button>
              <Button
                variant={tableTab === "rep" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setTableTab("rep")}
              >
                By Rep
              </Button>
              <Button
                variant={tableTab === "budget" ? "default" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => setTableTab("budget")}
              >
                Budget
              </Button>
            </div>
            {tableTab === "budget" && (
              <Select
                value={selectedMonth ?? "all"}
                onValueChange={(v) => setSelectedMonth(v === "all" ? null : v)}
              >
                <SelectTrigger className="w-[130px] h-7 text-xs">
                  <SelectValue placeholder="All Months" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Months</SelectItem>
                  {Array.from({ length: 12 }, (_, i) => {
                    const m = String(i + 1).padStart(2, "0")
                    const key = `${year}-${m}`
                    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                    return (
                      <SelectItem key={key} value={key}>
                        {months[i]} {year}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto [&_td]:py-1.5 [&_th]:py-1.5">
            {tableTab === "budget" ? (
              <Table>
                <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Proj. Monthly</TableHead>
                    <TableHead className="text-right">% to Budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="border-b-2 border-border">
                    <TableCell className="font-medium" colSpan={5}>
                      <div className="flex items-center gap-6 text-sm">
                        <span>Work Days: <strong>{kpis.totalWorkDays}</strong></span>
                        <span>Days Completed: <strong>{kpis.daysCompleted}</strong></span>
                        <span>Sales/Day: <strong>{formatCurrencyFull(kpis.salesPerDay)}</strong></span>
                        <span>Sales/Day Needed: <strong>{formatCurrencyFull(kpis.salesPerDayNeeded)}</strong></span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {[
                    { label: "Sales ($)", budget: kpis.budgetDollars, actual: kpis.totalSales, projected: kpis.projectedMonthlySales, pct: kpis.toBudgetPct, fmt: formatCurrencyFull },
                    { label: "Contribution ($)", budget: kpis.budgetContribution, actual: kpis.contribution, projected: kpis.projectedMonthlyCont, pct: kpis.contToBudgetPct, fmt: formatCurrencyFull },
                    { label: "MSF", budget: kpis.budgetMSF, actual: kpis.totalMSF, projected: kpis.projectedMonthlyMSF, pct: kpis.msfToBudgetPct, fmt: (v: number) => formatNumber(v, 0) },
                    { label: "$ per MSF", budget: kpis.budgetedPerMSF, actual: kpis.salesPerMSF, projected: null, pct: kpis.perMsfToBudgetPct, fmt: (v: number) => `$${formatNumber(v, 2)}` },
                    { label: "Cont. $ per MSF", budget: kpis.budgetedContPerMSF, actual: kpis.contPerMSF, projected: null, pct: kpis.contPerMsfToBudgetPct, fmt: (v: number) => `$${formatNumber(v, 2)}` },
                  ].map((row) => (
                    <TableRow key={row.label}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right">{row.fmt(row.budget)}</TableCell>
                      <TableCell className="text-right">{row.fmt(row.actual)}</TableCell>
                      <TableCell className="text-right">{row.projected !== null ? row.fmt(row.projected) : "—"}</TableCell>
                      <TableCell className="text-right">
                        <span className={row.pct >= 100 ? "text-green-500" : row.pct >= 75 ? "text-yellow-500" : "text-red-500"}>
                          {row.budget > 0 ? formatPercent(row.pct) : "—"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : tableTab === "customer" ? (
              <Table>
                <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                  <TableRow>
                    <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleCustomerSort("customerName")}>
                      Customer {customerSort.key === "customerName" && (customerSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleCustomerSort("repName")}>
                      Rep {customerSort.key === "repName" && (customerSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleCustomerSort("totalSales")}>
                      Total Sales {customerSort.key === "totalSales" && (customerSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleCustomerSort("totalMSF")}>
                      MSF {customerSort.key === "totalMSF" && (customerSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="text-right">$/MSF</TableHead>
                    <TableHead className="text-right">Cont. $</TableHead>
                    <TableHead className="text-right">Cont. %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCustomerData.map((c, i) => {
                    const contribution = c.totalSales - c.totalCost
                    const contPct = c.totalSales > 0 ? (contribution / c.totalSales) * 100 : 0
                    const salesPerMSF = c.totalMSF > 0 ? c.totalSales / c.totalMSF : 0
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium max-w-[200px] truncate">{c.customerName}</TableCell>
                        <TableCell className="text-muted-foreground max-w-[120px] truncate">{c.repName || "Unassigned"}</TableCell>
                        <TableCell className="text-right">{formatCurrencyFull(c.totalSales)}</TableCell>
                        <TableCell className="text-right">{formatNumber(c.totalMSF, 0)}</TableCell>
                        <TableCell className="text-right">${formatNumber(salesPerMSF, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrencyFull(contribution)}</TableCell>
                        <TableCell className="text-right">{formatPercent(contPct)}</TableCell>
                      </TableRow>
                    )
                  })}
                  {filteredCustomerData.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No customer data for this period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                  <TableRow>
                    <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleRepSort("repName")}>
                      Rep {repSort.key === "repName" && (repSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleRepSort("totalSales")}>
                      Total Sales {repSort.key === "totalSales" && (repSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleRepSort("totalMSF")}>
                      MSF {repSort.key === "totalMSF" && (repSort.dir === "asc" ? "↑" : "↓")}
                    </TableHead>
                    <TableHead className="text-right">$/MSF</TableHead>
                    <TableHead className="text-right">Cont. $</TableHead>
                    <TableHead className="text-right">Cont. %</TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleRepSort("totalSales")}>
                      Budget {repSort.key === "totalSales" && ""}
                    </TableHead>
                    <TableHead className="text-right">% to Budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRepData.map((r, i) => {
                    const contribution = r.totalSales - r.totalCost
                    const contPct = r.totalSales > 0 ? (contribution / r.totalSales) * 100 : 0
                    const salesPerMSF = r.totalMSF > 0 ? r.totalSales / r.totalMSF : 0
                    const budget = budgetByRep.get(r.repName || "") ?? 0
                    const toBudgetPct = budget > 0 ? (r.totalSales / budget) * 100 : 0
                    return (
                      <TableRow key={i} className={repFilter !== "all" && r.repName !== repFilter ? "opacity-40" : ""}>
                        <TableCell className="font-medium">{r.repName || "Unassigned"}</TableCell>
                        <TableCell className="text-right">{formatCurrencyFull(r.totalSales)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.totalMSF, 0)}</TableCell>
                        <TableCell className="text-right">${formatNumber(salesPerMSF, 2)}</TableCell>
                        <TableCell className="text-right">{formatCurrencyFull(contribution)}</TableCell>
                        <TableCell className="text-right">{formatPercent(contPct)}</TableCell>
                        <TableCell className="text-right">{formatCurrencyFull(budget)}</TableCell>
                        <TableCell className="text-right">{budget > 0 ? formatPercent(toBudgetPct) : "—"}</TableCell>
                      </TableRow>
                    )
                  })}
                  {sortedRepData.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No rep data for this period
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
