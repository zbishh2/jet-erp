import { useState, useMemo, useCallback, useEffect, useRef } from "react"
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
import { SearchableSelect } from "@/components/ui/searchable-select"
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Info,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import {
  useSalesDateLimits,
  useSalesSummary,
  useSalesByRep,
  useSalesByCustomer,
  useSalesDetail,
  useSalesReps,
  useSalesCustomers,
  useSalesBudgets,
  useHolidays,
} from "@/api/hooks/useSalesDashboard"
import type { SalesDetailRow, Granularity } from "@/api/hooks/useSalesDashboard"
import { TimePresetBar } from "@/components/ui/time-preset-bar"
import {
  type TimeWindow,
  type DateRange,
  getDefaultPreset,
  getTimeWindowRange as sharedGetTimeWindowRange,
  isValidPreset,
} from "@/lib/time-presets"

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

function getPeriodLabel(period: string, granularity: string): string {
  if (granularity === "yearly") return period // "2025"
  if (granularity === "daily" || granularity === "weekly") {
    // period is "2025-03-10" → "3/10"
    const [, mm, dd] = period.split("-")
    return `${parseInt(mm, 10)}/${parseInt(dd, 10)}`
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
  tooltip?: string
}

function KpiCard({ title, value, description, trend, tooltip }: KpiCardProps) {
  return (
    <Card className="bg-background-secondary">
      <CardContent className="p-4 h-full flex flex-col items-center justify-center text-center">
        <p className="text-sm font-medium text-muted-foreground inline-flex items-center gap-1">
          {title}
          {tooltip && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[250px] text-xs bg-background-secondary text-foreground border border-border">
                  <p>{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </p>
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
  const [timeWindow, setTimeWindow] = usePersistedState<TimeWindow>("timeWindow", "last-6m")
  const [quarter, setQuarter] = usePersistedState<Quarter>("quarter", "all")
  const [repFilter, setRepFilter] = usePersistedState<string>("repFilter", "all")
  const [customerFilter, setCustomerFilter] = usePersistedState<string>("customerFilter", "all")
  const [chartMode, setChartMode] = usePersistedState<"budget" | "yoy">("chartMode", "budget")
  const [granularity, setGranularity] = usePersistedState<Granularity>("granularity", "monthly")
  const [customStart, setCustomStart] = usePersistedState<string>("customStart", "")
  const [customEnd, setCustomEnd] = usePersistedState<string>("customEnd", "")
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [selectedDetailKey, setSelectedDetailKey] = useState<string | null>(null)
  const [budgetMonth, setBudgetMonth] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  })

  // Clear selected month when major filters change so it doesn't go stale
  useEffect(() => {
    setSelectedMonth(null)
  }, [timeWindow, quarter, granularity])

  // Switch presets when granularity changes
  const prevGranularityRef = useRef(granularity)
  useEffect(() => {
    if (prevGranularityRef.current === granularity) return
    prevGranularityRef.current = granularity
    setTimeWindow(getDefaultPreset(granularity))
  }, [granularity, setTimeWindow])

  // Validate persisted timeWindow against current granularity
  useEffect(() => {
    if (!isValidPreset(timeWindow, granularity)) {
      setTimeWindow(getDefaultPreset(granularity))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const salesDateLimits = useSalesDateLimits()
  const salesLimits = salesDateLimits.data?.data?.[0]
  const customRange: DateRange | null = customStart && customEnd ? { startDate: customStart, endDate: customEnd } : null

  const { startDate, endDate } = useMemo(
    () => sharedGetTimeWindowRange(timeWindow, salesLimits ? { minDate: salesLimits.minDate, maxDate: salesLimits.maxDate } : null, customRange),
    [timeWindow, salesLimits?.minDate, salesLimits?.maxDate, customRange]
  )

  // Keep budgetMonth in sync with selected date range
  useEffect(() => {
    const now = new Date()
    const rangeYear = new Date(startDate || now.toISOString()).getFullYear()
    const m = rangeYear === now.getFullYear() ? now.getMonth() + 1 : 1
    setBudgetMonth(`${rangeYear}-${String(m).padStart(2, "0")}`)
  }, [startDate])

  // Derive budget year from the date range start
  const budgetYear = String(new Date(startDate || new Date().toISOString()).getFullYear())

  // Prior year date range for YOY
  const priorYearStart = useMemo(() => {
    const d = new Date(startDate)
    return `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  }, [startDate])
  const priorYearEnd = useMemo(() => {
    const d = new Date(endDate)
    return `${d.getFullYear() - 1}-${String(d.getMonth() + 1).padStart(2, "0")}-01`
  }, [endDate])

  const summaryStart = startDate
  const summaryEnd = endDate

  const activeRep = repFilter !== "all" ? repFilter : undefined
  const activeCustomer = customerFilter !== "all" ? customerFilter : undefined

  // Narrow date range when a period is selected (for rep + customer queries)
  const [detailStart, detailEnd] = useMemo(() => {
    if (!selectedMonth) return [startDate, endDate]
    if (granularity === "yearly") {
      return [`${selectedMonth}-01-01`, `${parseInt(selectedMonth) + 1}-01-01`]
    }
    if (granularity === "daily") {
      // selectedMonth is a date like "2026-01-15", range is that single day
      const d = new Date(selectedMonth)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      return [d.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
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

  const summaryQuery = useSalesSummary(summaryStart, summaryEnd, granularity, activeRep, activeCustomer)
  const priorYearQuery = useSalesSummary(priorYearStart, priorYearEnd, granularity, activeRep, activeCustomer)
  const byRepQuery = useSalesByRep(detailStart, detailEnd)
  const byCustomerQuery = useSalesByCustomer(detailStart, detailEnd)
  const salesDetailQuery = useSalesDetail(detailStart, detailEnd)
  const repsQuery = useSalesReps()
  const customersQuery = useSalesCustomers()
  const budgetsQuery = useSalesBudgets(budgetYear)
  const holidaysQuery = useHolidays(startDate, endDate)

  // Seasonality: full prior-year data for projection model
  const viewingCurrentYear = timeWindow === "ytd" || timeWindow === `year-${currentYear}` ||
    (timeWindow === "custom" && startDate.startsWith(String(currentYear)))
  const seasonalityY1Query = useSalesSummary(
    `${currentYear - 1}-01-01`, `${currentYear}-01-01`, "monthly", activeRep, activeCustomer
  )
  const seasonalityY2Query = useSalesSummary(
    `${currentYear - 2}-01-01`, `${currentYear - 1}-01-01`, "monthly", activeRep, activeCustomer
  )

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
  const byCustomerData = byCustomerQuery.data?.data ?? []
  const salesDetailData = salesDetailQuery.data?.data ?? []
  const reps = repsQuery.data?.data ?? []
  const customers = customersQuery.data?.data ?? []
  const budgets = budgetsQuery.data?.data ?? []

  // Reps sorted by sales (repData is already sorted by totalSales DESC)
  const sortedReps = useMemo(() => {
    const repSalesOrder = repData.map((r) => r.repName).filter(Boolean) as string[]
    const repSet = new Set(repSalesOrder)
    // Append any reps from the full list that had no sales in this period
    const remaining = reps.filter((r) => !repSet.has(r.repName)).map((r) => r.repName)
    return [...repSalesOrder, ...remaining]
  }, [repData, reps])

  // Customers sorted by sales (byCustomerData is sorted by totalSales DESC)
  const sortedCustomers = useMemo(() => {
    const custSalesOrder = byCustomerData.map((c) => c.customerName).filter(Boolean) as string[]
    // Deduplicate (byCustomer has one row per customer+rep combo)
    const seen = new Set<string>()
    const deduped: string[] = []
    for (const name of custSalesOrder) {
      if (!seen.has(name)) {
        seen.add(name)
        deduped.push(name)
      }
    }
    // Append any customers from the full list that had no sales in this period
    const remaining = customers.filter((c) => !seen.has(c.customerName)).map((c) => c.customerName)
    return [...deduped, ...remaining]
  }, [byCustomerData, customers])

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
        if (granularity === "daily") {
          // selectedMonth is a date like "2026-01-15" — only include that month's budget, prorated
          const dayMonth = selectedMonth.substring(0, 7)
          if (bMonth !== dayMonth) continue
        }
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

  // Seasonality indices for projection model (ratio-to-annual)
  const seasonalityIndices = useMemo(() => {
    const y1Data = seasonalityY1Query.data?.data ?? []
    const y2Data = seasonalityY2Query.data?.data ?? []

    const computeIndices = (data: typeof y1Data) => {
      const total = data.reduce((s, m) => s + m.totalSales, 0)
      if (total <= 0) return null
      const map = new Map<number, number>()
      for (const m of data) {
        const month = parseInt(m.period.split("-")[1], 10)
        map.set(month, m.totalSales / total)
      }
      return map
    }

    const y1Indices = computeIndices(y1Data)
    const y2Indices = computeIndices(y2Data)

    // Multi-year average (best signal)
    if (y1Indices && y2Indices) {
      const averaged = new Map<number, number>()
      for (let m = 1; m <= 12; m++) {
        averaged.set(m, ((y1Indices.get(m) ?? 0) + (y2Indices.get(m) ?? 0)) / 2)
      }
      return { source: "actuals" as const, indices: averaged, years: 2 }
    }

    // Single prior year
    if (y1Indices) {
      return { source: "actuals" as const, indices: y1Indices, years: 1 }
    }

    // Budget fallback — use monthly budget distribution as proxy for seasonality
    const budgetMonthly = new Map<number, number>()
    for (const b of budgets) {
      if (repFilter !== "all" && b.salesRep !== repFilter) continue
      const month = parseInt(b.month.substring(5, 7), 10)
      budgetMonthly.set(month, (budgetMonthly.get(month) ?? 0) + b.budgetedDollars)
    }
    const budgetTotal = Array.from(budgetMonthly.values()).reduce((s, v) => s + v, 0)
    if (budgetTotal > 0) {
      const map = new Map<number, number>()
      for (const [month, val] of budgetMonthly) {
        map.set(month, val / budgetTotal)
      }
      return { source: "budget" as const, indices: map, years: 0 }
    }

    // Uniform fallback (1/12 per month)
    const uniform = new Map<number, number>()
    for (let m = 1; m <= 12; m++) uniform.set(m, 1 / 12)
    return { source: "uniform" as const, indices: uniform, years: 0 }
  }, [seasonalityY1Query.data, seasonalityY2Query.data, budgets, repFilter])

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

  // Projection chart data: 12 months with actuals + forecast
  const projectionChartData = useMemo(() => {
    if (!viewingCurrentYear || granularity !== "monthly") return []
    const currentMonth = new Date().getMonth() + 1
    const completed = summaryData.filter((m) => {
      const monthNum = parseInt(m.period.split("-")[1], 10)
      return monthNum < currentMonth
    })
    const sumActuals = completed.reduce((s, m) => s + m.totalSales, 0)
    const sumIdx = completed.reduce((s, m) => {
      const month = parseInt(m.period.split("-")[1], 10)
      return s + (seasonalityIndices.indices.get(month) ?? 1 / 12)
    }, 0)
    const impliedAnnual = sumIdx > 0 ? sumActuals / sumIdx : 0
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const monthKey = `${currentYear}-${String(m).padStart(2, "0")}`
      const actual = summaryData.find((d) => d.period === monthKey)
      const isCompleted = m < currentMonth
      const projected = impliedAnnual * (seasonalityIndices.indices.get(m) ?? 1 / 12)
      const budget = budgetByPeriod.get(monthKey)
      const pyKey = String(m).padStart(2, "0")
      const py = priorYearByPeriod.get(pyKey)

      return {
        label: months[i],
        periodKey: monthKey,
        actual: isCompleted ? (actual?.totalSales ?? 0) : null,
        // Bridge: last completed month gets both actual and projected so lines connect
        projected: m === currentMonth - 1
          ? (actual?.totalSales ?? 0)
          : !isCompleted ? projected : null,
        budget: budget?.dollars ?? 0,
        priorYear: py?.totalSales ?? 0,
      }
    })
  }, [viewingCurrentYear, granularity, summaryData, seasonalityIndices, currentYear, budgetByPeriod, priorYearByPeriod])

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

    // Projected annual — seasonality-adjusted when viewing current year
    const periodsWithData = filteredSummary.length
    let projectedAnnual: number
    if (viewingCurrentYear && granularity === "monthly") {
      const cm = new Date().getMonth() + 1
      const completed = summaryData.filter((m) => {
        const monthNum = parseInt(m.period.split("-")[1], 10)
        return monthNum < cm
      })
      const sumActuals = completed.reduce((s, m) => s + m.totalSales, 0)
      const sumIdx = completed.reduce((s, m) => {
        const month = parseInt(m.period.split("-")[1], 10)
        return s + (seasonalityIndices.indices.get(month) ?? 1 / 12)
      }, 0)
      projectedAnnual = (sumIdx > 0 && completed.length > 0)
        ? sumActuals / sumIdx
        : (periodsWithData > 0 ? (totalSales / periodsWithData) * 12 : 0)
    } else {
      projectedAnnual = periodsWithData > 0 ? (totalSales / periodsWithData) * 12 : 0
    }

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

    // Projected monthly: sales per day * total work days in period
    const projectedMonthlySales = daysCompleted > 0 ? (totalSales / daysCompleted) * totalWorkDays : 0
    const projectedMonthlyCont = daysCompleted > 0 ? (contribution / daysCompleted) * totalWorkDays : 0
    const projectedMonthlyMSF = daysCompleted > 0 ? (totalMSF / daysCompleted) * totalWorkDays : 0

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
  }, [filteredSummary, summaryData, budgetByPeriod, selectedMonth, detailStart, detailEnd, holidayDates, viewingCurrentYear, granularity, seasonalityIndices])

  // Budget tab KPIs — scoped to budgetMonth, independent of selectedMonth
  const budgetKpis = useMemo(() => {
    // Match summary periods that fall within budgetMonth regardless of granularity
    // monthly: "2026-02" === "2026-02", weekly/daily: "2026-02-03".startsWith("2026-02")
    const periods = summaryData.filter((m) =>
      granularity === "monthly" ? m.period === budgetMonth : m.period.startsWith(budgetMonth)
    )
    const totalSales = periods.reduce((sum, m) => sum + m.totalSales, 0)
    const totalMSF = periods.reduce((sum, m) => sum + m.totalMSF, 0)
    const totalCost = periods.reduce((sum, m) => sum + m.totalCost, 0)
    const contribution = totalSales - totalCost
    const salesPerMSF = totalMSF > 0 ? totalSales / totalMSF : 0

    // Build budget from raw budget records (always monthly-keyed, not affected by granularity)
    let budgetDollars = 0, budgetMSF = 0, budgetContribution = 0
    for (const b of budgets) {
      if (b.month.substring(0, 7) !== budgetMonth) continue
      if (repFilter !== "all" && b.salesRep !== repFilter) continue
      budgetDollars += b.budgetedDollars
      budgetMSF += b.budgetedMsf
      budgetContribution += b.budgetedContribution
    }

    // Work days for this single month
    const [bY, bM] = budgetMonth.split("-").map(Number)
    const monthStart = new Date(bY, bM - 1, 1)
    const monthEnd = new Date(bY, bM, 1)
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
    const totalWorkDays = countNetWorkDays(monthStart, monthEnd)
    const elapsed = today < monthEnd ? today : monthEnd
    const daysCompleted = countNetWorkDays(monthStart, elapsed)
    const salesPerDay = daysCompleted > 0 ? totalSales / daysCompleted : 0
    const remainingDays = totalWorkDays - daysCompleted
    const remainingSales = budgetDollars - totalSales
    const salesPerDayNeeded = remainingDays > 0 ? Math.max(0, remainingSales / remainingDays) : 0

    const projectedMonthlySales = daysCompleted > 0 ? (totalSales / daysCompleted) * totalWorkDays : 0
    const projectedMonthlyCont = daysCompleted > 0 ? (contribution / daysCompleted) * totalWorkDays : 0
    const projectedMonthlyMSF = daysCompleted > 0 ? (totalMSF / daysCompleted) * totalWorkDays : 0

    const budgetedPerMSF = budgetMSF > 0 ? budgetDollars / budgetMSF : 0
    const budgetedContPerMSF = budgetMSF > 0 ? budgetContribution / budgetMSF : 0
    const contPerMSF = totalMSF > 0 ? contribution / totalMSF : 0

    return {
      totalSales, totalMSF, contribution, salesPerMSF,
      budgetDollars, budgetMSF, budgetContribution,
      toBudgetPct: budgetDollars > 0 ? (totalSales / budgetDollars) * 100 : 0,
      totalWorkDays, daysCompleted, salesPerDay, salesPerDayNeeded,
      projectedMonthlySales, projectedMonthlyCont, projectedMonthlyMSF,
      budgetedPerMSF, budgetedContPerMSF, contPerMSF,
      contToBudgetPct: budgetContribution > 0 ? (contribution / budgetContribution) * 100 : 0,
      msfToBudgetPct: budgetMSF > 0 ? (totalMSF / budgetMSF) * 100 : 0,
      perMsfToBudgetPct: budgetedPerMSF > 0 ? (salesPerMSF / budgetedPerMSF) * 100 : 0,
      contPerMsfToBudgetPct: budgetedContPerMSF > 0 ? (contPerMSF / budgetedContPerMSF) * 100 : 0,
    }
  }, [summaryData, budgets, repFilter, granularity, budgetMonth, holidayDates])

  // Detail table state
  const [detailTab, setDetailTab] = usePersistedState<"detail" | "budget">("detailTab", "detail")
  const [detailSort, setDetailSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("detailSort", { key: "invoiceDate", dir: "desc" })
  const groupByDimOptions = [
    ["invoiceDate", "Date"],
    ["customerName", "Customer"],
    ["repName", "Rep"],
    ["invoiceNumber", "Invoice #"],
  ] as const
  const [groupByDims, setGroupByDims] = usePersistedState<string[]>("groupByDims", ["invoiceDate", "customerName", "repName", "invoiceNumber"])

  // Detail date helpers
  function parseSalesDate(value: string): Date | null {
    const raw = value.trim()
    if (!raw) return null
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
    if (slashMatch) {
      const yearPart = Number(slashMatch[3])
      const yr = yearPart < 100 ? 2000 + yearPart : yearPart
      return new Date(yr, Number(slashMatch[1]) - 1, Number(slashMatch[2]))
    }
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  function formatSalesDate(value: string): string {
    const parsed = parseSalesDate(value)
    if (!parsed) return value
    return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).format(parsed)
  }

  function getSalesDateSortKey(value: string): string {
    const parsed = parseSalesDate(value)
    return parsed ? parsed.toISOString().slice(0, 10) : value
  }

  // Normalize detail rows
  const detailRows = useMemo(() => {
    let data = salesDetailData as SalesDetailRow[]
    if (repFilter !== "all") {
      data = data.filter((r) => r.repName === repFilter)
    }
    if (customerFilter !== "all") {
      data = data.filter((r) => r.customerName === customerFilter)
    }
    return data.map((row) => {
      const contribution = row.totalSales - row.totalCost
      const salesPerMSF = row.totalMSF > 0 ? row.totalSales / row.totalMSF : 0
      const contPct = row.totalSales > 0 ? (contribution / row.totalSales) * 100 : 0
      return {
        invoiceDate: formatSalesDate(row.invoiceDate),
        invoiceDateSort: getSalesDateSortKey(row.invoiceDate),
        customerName: row.customerName,
        repName: row.repName || "Unassigned",
        invoiceNumber: row.invoiceNumber,
        totalSales: row.totalSales,
        totalMSF: row.totalMSF,
        totalCost: row.totalCost,
        salesPerMSF,
        contribution,
        contPct,
      }
    })
  }, [salesDetailData, repFilter, customerFilter])

  // Group detail rows by active dims
  const groupedDetailRows = useMemo(() => {
    const allDims = groupByDimOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return detailRows

    const grouped = new Map<string, typeof detailRows[number]>()
    for (const row of detailRows) {
      const keyParts = activeDims.map((d) => {
        return (row as unknown as Record<string, unknown>)[d] as string
      })
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          ...row,
          invoiceDate: activeDims.includes("invoiceDate") ? row.invoiceDate : "",
          invoiceDateSort: activeDims.includes("invoiceDate") ? row.invoiceDateSort : "",
          customerName: activeDims.includes("customerName") ? row.customerName : "",
          repName: activeDims.includes("repName") ? row.repName : "",
          invoiceNumber: activeDims.includes("invoiceNumber") ? row.invoiceNumber : "",
        })
      } else {
        existing.totalSales += row.totalSales
        existing.totalMSF += row.totalMSF
        existing.totalCost += row.totalCost
        // Recompute derived fields from sums
        existing.contribution = existing.totalSales - existing.totalCost
        existing.salesPerMSF = existing.totalMSF > 0 ? existing.totalSales / existing.totalMSF : 0
        existing.contPct = existing.totalSales > 0 ? (existing.contribution / existing.totalSales) * 100 : 0
      }
    }
    return [...grouped.values()]
  }, [detailRows, groupByDims, groupByDimOptions])

  // Sort detail rows
  const sortedDetailRows = useMemo(() => {
    const data = [...groupedDetailRows]
    const isDateSort = detailSort.key === "invoiceDate"
    data.sort((a, b) => {
      const aVal = isDateSort ? a.invoiceDateSort : (a as unknown as Record<string, unknown>)[detailSort.key]
      const bVal = isDateSort ? b.invoiceDateSort : (b as unknown as Record<string, unknown>)[detailSort.key]
      if (typeof aVal === "number" && typeof bVal === "number") {
        return detailSort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal ?? "")
      const bStr = String(bVal ?? "")
      return detailSort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
    return data
  }, [groupedDetailRows, detailSort])

  // Detail totals
  const detailTotals = useMemo(() => {
    const totalSales = detailRows.reduce((s, r) => s + r.totalSales, 0)
    const totalMSF = detailRows.reduce((s, r) => s + r.totalMSF, 0)
    const totalCost = detailRows.reduce((s, r) => s + r.totalCost, 0)
    const contribution = totalSales - totalCost
    const salesPerMSF = totalMSF > 0 ? totalSales / totalMSF : 0
    const contPct = totalSales > 0 ? (contribution / totalSales) * 100 : 0
    return { totalSales, totalMSF, totalCost, salesPerMSF, contribution, contPct }
  }, [detailRows])

  const detailSortIndicator = (key: string) => detailSort.key === key ? (detailSort.dir === "asc" ? " \u2191" : " \u2193") : ""

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

  const handleDetailSort = (key: string) => {
    setDetailSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }))
  }

  // Build a unique key for a detail row based on active group-by dims
  const getDetailRowKey = useCallback((row: typeof sortedDetailRows[number]) => {
    return groupByDims.map((d) => String((row as unknown as Record<string, unknown>)[d] ?? "")).join("|")
  }, [groupByDims])

  const handleDetailRowClick = useCallback((row: typeof sortedDetailRows[number]) => {
    const key = getDetailRowKey(row)
    const isDeselecting = selectedDetailKey === key

    if (isDeselecting) {
      // Toggle off — clear the filters we applied
      setSelectedDetailKey(null)
      setCustomerFilter("all")
      setRepFilter("all")
      return
    }

    // Select this row and apply its dims as dashboard filters
    setSelectedDetailKey(key)
    if (groupByDims.includes("customerName") && row.customerName) {
      setCustomerFilter(row.customerName)
    } else {
      setCustomerFilter("all")
    }
    if (groupByDims.includes("repName") && row.repName && row.repName !== "Unassigned") {
      setRepFilter(row.repName)
    } else {
      setRepFilter("all")
    }
  }, [groupByDims, selectedDetailKey, getDetailRowKey, setCustomerFilter, setRepFilter])

  // Clear detail row selection when group-by dims change
  useEffect(() => {
    setSelectedDetailKey(null)
  }, [groupByDims])

  const resetFilters = useCallback(() => {
    setTimeWindow(getDefaultPreset("monthly"))
    setQuarter("all")
    setRepFilter("all")
    setCustomerFilter("all")
    setChartMode("budget")
    setGranularity("monthly")
    setSelectedMonth(null)
    setSelectedDetailKey(null)
    setDetailSort({ key: "invoiceDate", dir: "desc" })
    setDetailTab("detail")
    setGroupByDims(["invoiceDate", "customerName", "repName", "invoiceNumber"])
  }, [setTimeWindow, setQuarter, setRepFilter, setCustomerFilter, setChartMode, setGranularity, setDetailSort, setDetailTab, setGroupByDims])

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
  const renderAreaLabel = useCallback((formatter: (v: number) => string, totalOverride?: number) => {
    const total = totalOverride ?? chartData.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (props: any) => {
      const { x, y, value, index } = props
      if (value == null || !isFinite(x) || !isFinite(y)) return null
      const anchor = index === 0 ? "start" : index === total - 1 ? "end" : "middle"
      return (
        <text x={x} y={y - 10} fill="var(--color-text)" fontSize={11} textAnchor={anchor}>
          {formatter(value)}
        </text>
      )
    }
  }, [chartData.length])

  // Scrollable chart for weekly view
  const chartScrollRef = useRef<HTMLDivElement>(null)
  const maxVisiblePoints = 16
  const needsScroll = (granularity === "weekly" || granularity === "daily") && chartData.length > maxVisiblePoints
  const chartWidth = needsScroll ? chartData.length * 70 : undefined // 70px per week

  // Auto-scroll to the right (most recent) when data changes
  useEffect(() => {
    if (needsScroll && chartScrollRef.current) {
      chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth
    }
  }, [needsScroll, chartData.length])

  const chartLoading = summaryQuery.isLoading || priorYearQuery.isLoading || seasonalityY1Query.isLoading || seasonalityY2Query.isLoading
  const repLoading = byRepQuery.isLoading
  const isLoading = chartLoading || repLoading || salesDetailQuery.isLoading

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
          <SearchableSelect
            value={repFilter}
            onValueChange={setRepFilter}
            options={sortedReps}
            placeholder="All Reps"
            searchPlaceholder="Search reps..."
            width="w-[160px]"
          />
          <SearchableSelect
            value={customerFilter}
            onValueChange={setCustomerFilter}
            options={sortedCustomers}
            placeholder="All Customers"
            searchPlaceholder="Search customers..."
            width="w-[180px]"
          />

          <TimePresetBar
            granularity={granularity}
            value={timeWindow}
            onChange={setTimeWindow}
            dateLimits={salesLimits ? { minDate: salesLimits.minDate, maxDate: salesLimits.maxDate } : null}
            customRange={customRange}
            onCustomRangeChange={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
          />
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
          description={(() => {
            if (!viewingCurrentYear || granularity !== "monthly") return undefined
            const cm = new Date().getMonth() // completed months count (0-indexed month = count of complete months)
            if (cm >= 6 && seasonalityIndices.source === "actuals") return "High confidence"
            if (cm >= 3 && seasonalityIndices.source !== "uniform") return "Medium confidence"
            return "Low confidence"
          })()}
          tooltip={
            viewingCurrentYear && granularity === "monthly"
              ? seasonalityIndices.source === "actuals"
                ? `Seasonality-adjusted using ${seasonalityIndices.years} prior year${seasonalityIndices.years > 1 ? "s" : ""} of sales patterns. ${new Date().getMonth()} completed month${new Date().getMonth() !== 1 ? "s" : ""}.`
                : seasonalityIndices.source === "budget"
                ? `Seasonality-adjusted using budget allocations. ${new Date().getMonth()} completed months.`
                : "Simple average (total / months x 12). No prior year data for seasonal adjustment."
              : "(Total sales / months with data) x 12. Extrapolates the average monthly sales to a full year."
          }
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
                    {(["yearly", "monthly", "weekly", "daily"] as Granularity[]).map((g) => (
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
                  {viewingCurrentYear && granularity === "monthly" && (
                    <TabsTrigger value="projection">Projection</TabsTrigger>
                  )}
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
                <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                <div style={needsScroll ? { width: chartWidth } : undefined}>
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
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compSales} name={compLabel} stroke="#a78bfa" fill="url(#gradBudget)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="totalSales" name="Actual" stroke="#6366f1" fill="url(#gradActual)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
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
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compMSF} name={compLabel} stroke="#a78bfa" fill="url(#gradBudgetMSF)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="totalMSF" name="Actual" stroke="#6366f1" fill="url(#gradActualMSF)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
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
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compContribution} name={compLabel} stroke="#a78bfa" fill="url(#gradBudgetCont)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="contribution" name="Actual" stroke="#6366f1" fill="url(#gradActualCont)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
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
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                        />
                        <Legend />
                        {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                        <Area type="monotone" dataKey={compPerMSF} name={compLabel} stroke="#a78bfa" fill="url(#gradBudgetPMSF)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
                        <Area type="monotone" dataKey="salesPerMSF" name="Actual" stroke="#6366f1" fill="url(#gradActualPMSF)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                          <LabelList dataKey="salesPerMSF" content={renderAreaLabel((v) => `$${formatNumber(v, 2)}`)} />
                        </Area>
                      </AreaChart>
                    </ResponsiveContainer>
                  </TabsContent>
                </div>
                </div>
                )
              })()}
              {/* Projection tab — rendered outside the IIFE since it uses its own dataset */}
              {!chartLoading && viewingCurrentYear && granularity === "monthly" && (
                <TabsContent value="projection" className="mt-0">
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={projectionChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }}>
                      <defs>
                        <linearGradient id="gradProjYTD" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient id="gradProjForecast" x1="0" y1="0" x2="0" y2="1">
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
                        contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                        itemStyle={{ color: "var(--color-text)" }}
                      />
                      <Legend />
                      <Area type="monotone" dataKey="priorYear" name="Prior Year" stroke="#64748b" fill="none" strokeWidth={1.5} strokeDasharray="3 3" isAnimationActive={false} dot={false} />
                      <Area type="monotone" dataKey="projected" name="Projected" stroke="#a78bfa" fill="url(#gradProjForecast)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} dot={{ r: 3, fill: "#a78bfa", stroke: "var(--color-bg)", strokeWidth: 1.5 }}>
                        <LabelList dataKey="projected" content={renderAreaLabel(formatCurrency, 12)} />
                      </Area>
                      <Area type="monotone" dataKey="actual" name="YTD Sales" stroke="#6366f1" fill="url(#gradProjYTD)" strokeWidth={2.5} isAnimationActive={false} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}>
                        <LabelList dataKey="actual" content={renderAreaLabel(formatCurrency, 12)} />
                      </Area>
                    </AreaChart>
                  </ResponsiveContainer>
                </TabsContent>
              )}
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
                        contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                        labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                        cursor={{ fill: "var(--color-bg-hover)" }}
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
                        <LabelList dataKey="actual" position="right" fill="var(--color-text)" fontSize={11} formatter={((v: number) => formatCurrency(v)) as any} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sales Detail Table — Detail / Budget */}
      <Card className="bg-background-secondary">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Sales Detail</CardTitle>
              <div className="flex items-center gap-1">
                <Button
                  variant={detailTab === "detail" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setDetailTab("detail")}
                >
                  Detail
                </Button>
                <Button
                  variant={detailTab === "budget" ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setDetailTab("budget")}
                >
                  Budget
                </Button>
              </div>
              {detailTab === "budget" && (
                <>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        const [y, m] = budgetMonth.split("-").map(Number)
                        const d = new Date(y, m - 2, 1)
                        setBudgetMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
                      }}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs font-medium min-w-[110px] text-center">
                      {(() => {
                        const [y, m] = budgetMonth.split("-").map(Number)
                        return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })
                      })()}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        const [y, m] = budgetMonth.split("-").map(Number)
                        const d = new Date(y, m, 1)
                        setBudgetMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
                      }}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <SearchableSelect
                    value={repFilter}
                    onValueChange={setRepFilter}
                    options={sortedReps}
                    placeholder="All Reps"
                    searchPlaceholder="Search reps..."
                    width="w-[150px]"
                  />
                </>
              )}
            </div>
            {detailTab === "detail" && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground mr-1">Group by:</span>
                {groupByDimOptions.map(([dim, label]) => (
                  <Button
                    key={dim}
                    variant={groupByDims.includes(dim) ? "default" : "outline"}
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      setGroupByDims((prev) =>
                        prev.includes(dim)
                          ? prev.length > 0 ? prev.filter((d) => d !== dim) : prev
                          : [...prev, dim]
                      )
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto [&_td]:py-1.5 [&_th]:py-1.5">
            {detailTab === "budget" ? (
              <>
              <div className="flex items-center gap-6 text-sm px-4 py-2 border-b border-border">
                <span className="text-muted-foreground">Work Days: <strong className="text-foreground">{budgetKpis.totalWorkDays}</strong></span>
                <span className="text-muted-foreground">Completed: <strong className="text-foreground">{budgetKpis.daysCompleted}</strong></span>
                <span className="text-muted-foreground">$/Day: <strong className="text-foreground">{formatCurrencyFull(budgetKpis.salesPerDay)}</strong></span>
                <span className="text-muted-foreground">$/Day Needed: <strong className="text-foreground">{formatCurrencyFull(budgetKpis.salesPerDayNeeded)}</strong></span>
              </div>
              <Table>
                <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                  <TableRow>
                    <TableHead>Metric</TableHead>
                    <TableHead className="text-right">Budget</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">
                              Proj. Monthly
                              <Info className="h-3.5 w-3.5 text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[250px] text-xs bg-background-secondary text-foreground border border-border">
                            <p>Daily run rate (actual / days completed) extrapolated to full month work days.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                    <TableHead className="text-right">% to Budget</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { label: "Sales ($)", budget: budgetKpis.budgetDollars, actual: budgetKpis.totalSales, projected: budgetKpis.projectedMonthlySales, pct: budgetKpis.toBudgetPct, fmt: formatCurrencyFull },
                    { label: "Contribution ($)", budget: budgetKpis.budgetContribution, actual: budgetKpis.contribution, projected: budgetKpis.projectedMonthlyCont, pct: budgetKpis.contToBudgetPct, fmt: formatCurrencyFull },
                    { label: "MSF", budget: budgetKpis.budgetMSF, actual: budgetKpis.totalMSF, projected: budgetKpis.projectedMonthlyMSF, pct: budgetKpis.msfToBudgetPct, fmt: (v: number) => formatNumber(v, 0) },
                    { label: "$ per MSF", budget: budgetKpis.budgetedPerMSF, actual: budgetKpis.salesPerMSF, projected: null, pct: budgetKpis.perMsfToBudgetPct, fmt: (v: number) => `$${formatNumber(v, 2)}` },
                    { label: "Cont. $ per MSF", budget: budgetKpis.budgetedContPerMSF, actual: budgetKpis.contPerMSF, projected: null, pct: budgetKpis.contPerMsfToBudgetPct, fmt: (v: number) => `$${formatNumber(v, 2)}` },
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
              </>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                  <TableRow>
                    {groupByDimOptions.map(([dim, label]) =>
                      groupByDims.includes(dim) ? (
                        <TableHead key={dim} className="cursor-pointer hover:text-foreground" onClick={() => handleDetailSort(dim)}>
                          {label}{detailSortIndicator(dim)}
                        </TableHead>
                      ) : null
                    )}
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleDetailSort("totalSales")}>
                      Sales{detailSortIndicator("totalSales")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleDetailSort("totalMSF")}>
                      MSF{detailSortIndicator("totalMSF")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleDetailSort("salesPerMSF")}>
                      $/MSF{detailSortIndicator("salesPerMSF")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleDetailSort("totalCost")}>
                      Cost{detailSortIndicator("totalCost")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleDetailSort("contribution")}>
                      Cont. ${detailSortIndicator("contribution")}
                    </TableHead>
                    <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleDetailSort("contPct")}>
                      Cont. %{detailSortIndicator("contPct")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedDetailRows.map((row, idx) => (
                    <TableRow key={`${row.invoiceDate}-${row.customerName}-${row.invoiceNumber}-${idx}`} className={`cursor-pointer hover:bg-[var(--color-bg-secondary)] ${selectedDetailKey === getDetailRowKey(row) ? "bg-indigo-500/15 hover:bg-indigo-500/20" : ""}`} onClick={() => handleDetailRowClick(row)}>
                      {groupByDimOptions.map(([dim]) =>
                        groupByDims.includes(dim) ? (
                          <TableCell key={dim} className={dim === "invoiceDate" ? "font-medium" : dim === "customerName" ? "max-w-[200px] truncate" : dim === "repName" ? "text-muted-foreground max-w-[120px] truncate" : ""}>
                            {String((row as unknown as Record<string, unknown>)[dim] ?? "")}
                          </TableCell>
                        ) : null
                      )}
                      <TableCell className="text-right">{formatCurrencyFull(row.totalSales)}</TableCell>
                      <TableCell className="text-right">{formatNumber(row.totalMSF, 0)}</TableCell>
                      <TableCell className="text-right">${formatNumber(row.salesPerMSF, 2)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyFull(row.totalCost)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyFull(row.contribution)}</TableCell>
                      <TableCell className="text-right">{formatPercent(row.contPct)}</TableCell>
                    </TableRow>
                  ))}
                  {sortedDetailRows.length === 0 && !isLoading && (
                    <TableRow>
                      <TableCell colSpan={99} className="text-center text-muted-foreground py-8">
                        No detail data for this period
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedDetailRows.length > 0 && (
                    <TableRow className="font-semibold border-t">
                      <TableCell colSpan={groupByDims.length || 1}>Total</TableCell>
                      <TableCell className="text-right">{formatCurrencyFull(detailTotals.totalSales)}</TableCell>
                      <TableCell className="text-right">{formatNumber(detailTotals.totalMSF, 0)}</TableCell>
                      <TableCell className="text-right">${formatNumber(detailTotals.salesPerMSF, 2)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyFull(detailTotals.totalCost)}</TableCell>
                      <TableCell className="text-right">{formatCurrencyFull(detailTotals.contribution)}</TableCell>
                      <TableCell className="text-right">{formatPercent(detailTotals.contPct)}</TableCell>
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
