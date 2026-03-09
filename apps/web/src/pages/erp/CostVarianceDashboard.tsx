import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SearchableSelect } from "@/components/ui/searchable-select"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ArrowLeft, RotateCcw, RefreshCw, Info, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react"
import {
  useCostVarianceDateLimits,
  useCostVarianceSummary,
  useCostVarianceDetails,
  useCostVarianceFilterOptions,
} from "@/api/hooks/useCostVarianceDashboard"
import {
  useInvoiceCostVarianceDateLimits,
  useInvoiceCostVarianceSummary,
  useInvoiceCostVarianceDetails,
  useInvoiceCostVarianceFilterOptions,
} from "@/api/hooks/useInvoiceCostVarianceDashboard"
import type { CostVarianceGranularity } from "@/api/hooks/useCostVarianceDashboard"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { CalendarIcon } from "lucide-react"
import {
  type DateRange,
  formatDateISO,
  addDays,
  parseISODate,
  startOfQuarter,
} from "@/lib/time-presets"

type DataSource = "production" | "invoice"
type ChartTab = "calendar" | "area"
type CostType = "full" | "material" | "labor" | "freight" | "hours-order" | "hours-uptime"
type DetailTab = "costs" | "hours"
type CVTimeWindow = "ytd" | "last-year" | "qtd" | "last-qtr" | "custom"

const CV_TIME_PRESETS: { key: CVTimeWindow; label: string }[] = [
  { key: "ytd", label: "This Year" },
  { key: "last-year", label: "Last Year" },
  { key: "qtd", label: "QTD" },
  { key: "last-qtr", label: "Last QTR" },
]

function getCVTimeRange(window: CVTimeWindow, customRange: DateRange | null, dateLimits: { minDate: string | null; maxDate: string | null } | null): DateRange {
  const now = new Date()
  const maxDataDate = dateLimits?.maxDate ? parseISODate(dateLimits.maxDate) : null
  const dataEndExclusive = maxDataDate
    ? formatDateISO(addDays(maxDataDate, 1))
    : formatDateISO(addDays(now, 1))

  if (window === "custom" && customRange) return customRange
  if (window === "ytd") return { startDate: `${now.getFullYear()}-01-01`, endDate: dataEndExclusive }
  if (window === "last-year") {
    const y = now.getFullYear() - 1
    return { startDate: `${y}-01-01`, endDate: `${y + 1}-01-01` }
  }
  if (window === "qtd") return { startDate: formatDateISO(startOfQuarter(now)), endDate: dataEndExclusive }
  if (window === "last-qtr") {
    const qStart = startOfQuarter(now)
    const prevQEnd = formatDateISO(qStart)
    const prevQStart = new Date(qStart)
    prevQStart.setMonth(prevQStart.getMonth() - 3)
    return { startDate: formatDateISO(prevQStart), endDate: prevQEnd }
  }
  return { startDate: `${now.getFullYear()}-01-01`, endDate: dataEndExclusive }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function usePersistedState<T>(prefix: string, key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `${prefix}${key}`
  const readStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored !== null ? JSON.parse(stored) as T : defaultValue
    } catch {
      return defaultValue
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])
  const [value, setValue] = useState<T>(readStorage)
  // Re-read from localStorage when the storage key changes (e.g. prefix swap)
  useEffect(() => {
    setValue(readStorage())
  }, [readStorage])
  const setPersisted = useCallback((val: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof val === "function" ? (val as (prev: T) => T)(prev) : val
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }, [storageKey])
  return [value, setPersisted]
}

interface KpiCardProps {
  title: string
  value: string
  tooltip?: string
  color?: "green" | "red" | "default"
}

function KpiCard({ title, value, tooltip, color = "default" }: KpiCardProps) {
  const colorClass = color === "green" ? "text-emerald-600 dark:text-emerald-400" : color === "red" ? "text-red-600 dark:text-red-400" : ""
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
        <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
}

function formatCurrencyDetail(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)
}

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value)
}


function getPeriodLabel(period: string, granularity: CostVarianceGranularity): string {
  if (granularity === "yearly") return period
  if (granularity === "monthly") {
    const [year, month] = period.split("-")
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${monthNames[Number(month) - 1]} '${year?.slice(-2)}`
  }
  const d = parseISODate(period)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getWeekRangeFromWeekStart(weekStart: string): { startDate: string; endDate: string } {
  const startDate = parseISODate(weekStart)
  return { startDate: formatDateISO(startDate), endDate: formatDateISO(addDays(startDate, 7)) }
}

function getPeriodRange(period: string, granularity: CostVarianceGranularity): { startDate: string; endDate: string } {
  if (granularity === "yearly") {
    const year = Number(period)
    return { startDate: `${year}-01-01`, endDate: `${year + 1}-01-01` }
  }
  if (granularity === "monthly") {
    const [year, month] = period.split("-").map(Number)
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    return { startDate: `${year}-${String(month).padStart(2, "0")}-01`, endDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01` }
  }
  if (granularity === "daily") {
    const next = formatDateISO(addDays(parseISODate(period), 1))
    return { startDate: period, endDate: next }
  }
  return getWeekRangeFromWeekStart(period)
}

function parseDashboardDate(value: string): Date | null {
  const raw = value.trim()
  if (!raw) return null
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slashMatch) {
    const yearPart = Number(slashMatch[3])
    const year = yearPart < 100 ? 2000 + yearPart : yearPart
    return new Date(year, Number(slashMatch[1]) - 1, Number(slashMatch[2]))
  }
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDashboardDate(value: unknown): string {
  const raw = String(value ?? "")
  const parsed = parseDashboardDate(raw)
  if (!parsed) return raw
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "2-digit" }).format(parsed)
}

function getDashboardDateSortKey(value: unknown): string {
  const raw = String(value ?? "")
  const parsed = parseDashboardDate(raw)
  return parsed ? formatDateISO(parsed) : raw
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${formatNumber(value, 0)}`
}

function getCalendarGrid(yearMonth: string): { date: number; key: string }[][] {
  const [y, m] = yearMonth.split("-").map(Number)
  const firstDay = new Date(y, m - 1, 1)
  const daysInMonth = new Date(y, m, 0).getDate()
  const startDow = (firstDay.getDay() + 6) % 7 // 0=Mon
  const weeks: { date: number; key: string }[][] = []
  let week: { date: number; key: string }[] = Array.from({ length: startDow }, () => ({ date: 0, key: "" }))
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${yearMonth}-${String(d).padStart(2, "0")}`
    week.push({ date: d, key })
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push({ date: 0, key: "" })
    weeks.push(week)
  }
  return weeks
}

function getMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleString("en-US", { month: "long", year: "numeric" })
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function getMonthDateRange(yearMonth: string): { startDate: string; endDate: string } {
  const [y, m] = yearMonth.split("-").map(Number)
  const start = `${yearMonth}-01`
  const nextMonth = new Date(y, m, 1)
  const end = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`
  return { startDate: start, endDate: end }
}

function getVarianceHeatColor(value: number, maxAbs: number): { bg: string; textColor: string } {
  if (maxAbs <= 0) return { bg: "transparent", textColor: "var(--color-text)" }
  const ratio = Math.min(Math.abs(value) / maxAbs, 1)
  if (ratio < 0.05) return { bg: "transparent", textColor: "var(--color-text)" }
  if (value > 0) {
    const r = Math.round(220 - 100 * ratio)
    const g = Math.round(240 - 20 * ratio)
    const b = Math.round(220 - 100 * ratio)
    const textColor = ratio > 0.5 ? "#ffffff" : "#1a1a1a"
    return { bg: `rgb(${r},${g},${b})`, textColor }
  }
  const r = Math.round(240 - 20 * ratio)
  const g = Math.round(220 - 100 * ratio)
  const b = Math.round(220 - 100 * ratio)
  const textColor = ratio > 0.5 ? "#ffffff" : "#1a1a1a"
  return { bg: `rgb(${r},${g},${b})`, textColor }
}

function varianceColor(v: number): "green" | "red" | "default" {
  if (v > 0) return "green"
  if (v < 0) return "red"
  return "default"
}

// ---------------------------------------------------------------------------
// Variant config
// ---------------------------------------------------------------------------

const VARIANT_CONFIG = {
  production: {
    storagePrefix: "cost-var-dash:",
    queryInvalidationKey: "cost-variance",
    backRoute: "/erp/production",
    dateField: "feedbackDate",
    defaultSortKey: "feedbackDate",
    defaultGroupByDims: ["feedbackDate", "jobNumber", "customerName", "specNumber", "lineNumber"],
    groupByOptions: [
      ["feedbackDate", "Date"],
      ["jobNumber", "Job #"],
      ["customerName", "Customer"],
      ["specNumber", "Spec"],
      ["lineNumber", "Line"],
    ] as [string, string][],
    costTypes: ["full", "material", "labor", "hours-order", "hours-uptime"] as CostType[],
    hasLineFilter: true,
    hasHoursMode: true,
    chartTitle: "Cost Variance Trend",
    gradientIdEst: "gradEst",
    gradientIdAct: "gradAct",
  },
  invoice: {
    storagePrefix: "inv-cost-var-dash:",
    queryInvalidationKey: "invoice-cost-variance",
    backRoute: "/erp/sales",
    dateField: "invoiceDate",
    defaultSortKey: "invoiceDate",
    defaultGroupByDims: ["invoiceDate", "invoiceNumber", "jobNumber", "customerName", "specNumber"],
    groupByOptions: [
      ["invoiceDate", "Date"],
      ["invoiceNumber", "Inv #"],
      ["jobNumber", "Job #"],
      ["customerName", "Customer"],
      ["specNumber", "Spec"],
    ] as [string, string][],
    costTypes: ["full", "material", "labor"] as CostType[],
    hasLineFilter: false,
    hasHoursMode: false,
    chartTitle: "Invoice Cost Variance Trend",
    gradientIdEst: "gradEstInv",
    gradientIdAct: "gradActInv",
  },
}

const DETAIL_PAGE_SIZE = 100

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CostVarianceDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const chartScrollRef = useRef<HTMLDivElement | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Top-level data source tab - persisted globally
  const [dataSource, setDataSource] = usePersistedState<DataSource>("cost-var-dash:", "dataSource", "production")
  const cfg = VARIANT_CONFIG[dataSource]

  // Per-variant persisted state
  const [timeWindow, setTimeWindow] = usePersistedState<CVTimeWindow>(cfg.storagePrefix, "timeWindow", "ytd")
  const [granularity, setGranularity] = usePersistedState<CostVarianceGranularity>(cfg.storagePrefix, "granularity", "daily")
  const [chartTab, setChartTab] = usePersistedState<ChartTab>(cfg.storagePrefix, "chartTab", "area")
  const [costType, setCostType] = usePersistedState<CostType>(cfg.storagePrefix, "costType", "full")
  const [lineFilter, setLineFilter] = usePersistedState<string>(cfg.storagePrefix, "lineFilter", "all")
  const [customerFilter, setCustomerFilter] = usePersistedState<string>(cfg.storagePrefix, "customerFilter", "all")
  const [salesRepFilter, setSalesRepFilter] = usePersistedState<string>(cfg.storagePrefix, "salesRepFilter", "all")
  const [specFilter, setSpecFilter] = usePersistedState<string>(cfg.storagePrefix, "specFilter", "all")
  const [jobFilter, setJobFilter] = usePersistedState<string>(cfg.storagePrefix, "jobFilter", "all")
  const [tableSort, setTableSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>(cfg.storagePrefix, "tableSort", { key: cfg.defaultSortKey, dir: "desc" })
  const [groupByDims, setGroupByDims] = usePersistedState<string[]>(cfg.storagePrefix, "groupByDims", cfg.defaultGroupByDims)
  const [customStart, setCustomStart] = usePersistedState<string>(cfg.storagePrefix, "customStart", "")
  const [customEnd, setCustomEnd] = usePersistedState<string>(cfg.storagePrefix, "customEnd", "")
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  const customRange: DateRange | null = customStart && customEnd ? { startDate: customStart, endDate: customEnd } : null

  // Scroll pagination state for detail table
  const [detailPage, setDetailPage] = useState(1)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [allDetailData, setAllDetailData] = useState<any[]>([])
  const lastLoadedPageRef = useRef(0)
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const hasMoreDetailRef = useRef(false)
  const isFetchingDetailRef = useRef(false)

  // Validate persisted timeWindow (handles old localStorage values from granularity-based presets)
  useEffect(() => {
    const validKeys = new Set<string>(CV_TIME_PRESETS.map((p) => p.key))
    validKeys.add("custom")
    if (!validKeys.has(timeWindow)) setTimeWindow("ytd")
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

const [detailTab, setDetailTab] = usePersistedState<DetailTab>(cfg.storagePrefix, "detailTab", "costs")
  const [costPer1000, setCostPer1000] = usePersistedState<boolean>(cfg.storagePrefix, "costPer1000", false)
  const [hoursSort, setHoursSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>(cfg.storagePrefix, "hoursSort", { key: cfg.defaultSortKey, dir: "desc" })
  const [calendarMonth, setCalendarMonth] = usePersistedState<string>(
    cfg.storagePrefix, "calendarMonth",
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
  )

  // ---- Production hooks (always called for stable hook order) ----
  const prodDateLimits = useCostVarianceDateLimits()
  const prodLimits = prodDateLimits.data?.data?.[0]
  const prodTimeRange = useMemo(
    () => dataSource === "production" ? getCVTimeRange(timeWindow, customRange, prodLimits ? { minDate: prodLimits.minDate, maxDate: prodLimits.maxDate } : null) : { startDate: "", endDate: "" },
    [dataSource, timeWindow, prodLimits?.minDate, prodLimits?.maxDate, customRange]
  )
  const prodActiveLine = lineFilter !== "all" ? lineFilter : undefined
  const prodActiveCustomer = dataSource === "production" && customerFilter !== "all" ? customerFilter : undefined
  const prodActiveSpec = dataSource === "production" && specFilter !== "all" ? specFilter : undefined
  const prodActiveJob = dataSource === "production" && jobFilter !== "all" ? jobFilter : undefined

  const prodDetailRange = useMemo(() => {
    if (dataSource !== "production") return { start: "", end: "" }
    if (!selectedPeriod) return { start: prodTimeRange.startDate, end: prodTimeRange.endDate }
    if (chartTab === "calendar" && selectedPeriod.length === 10) {
      return { start: selectedPeriod, end: formatDateISO(addDays(parseISODate(selectedPeriod), 1)) }
    }
    const range = getPeriodRange(selectedPeriod, granularity)
    return { start: range.startDate, end: range.endDate }
  }, [dataSource, selectedPeriod, prodTimeRange, granularity, chartTab])

  const prodCalendarRange = useMemo(() => dataSource === "production" ? getMonthDateRange(calendarMonth) : { startDate: "", endDate: "" }, [dataSource, calendarMonth])

  const activeSort = detailTab === "costs" ? tableSort : hoursSort
  const prodSummaryQuery = useCostVarianceSummary(prodTimeRange.startDate, prodTimeRange.endDate, granularity, prodActiveLine, prodActiveCustomer, prodActiveSpec, prodActiveJob)
  const prodDetailsQuery = useCostVarianceDetails(prodDetailRange.start, prodDetailRange.end, detailPage, DETAIL_PAGE_SIZE, activeSort.key, activeSort.dir, prodActiveLine, prodActiveCustomer, prodActiveSpec, prodActiveJob)
  const prodFilterOptionsQuery = useCostVarianceFilterOptions(prodTimeRange.startDate, prodTimeRange.endDate, prodActiveLine, prodActiveCustomer, prodActiveSpec, prodActiveJob)
  const prodCalendarQuery = useCostVarianceSummary(prodCalendarRange.startDate, prodCalendarRange.endDate, "daily", prodActiveLine, prodActiveCustomer, prodActiveSpec, prodActiveJob)

  // ---- Invoice hooks (always called for stable hook order) ----
  const invDateLimits = useInvoiceCostVarianceDateLimits()
  const invLimits = invDateLimits.data?.data?.[0]
  const invTimeRange = useMemo(
    () => dataSource === "invoice" ? getCVTimeRange(timeWindow, customRange, invLimits ? { minDate: invLimits.minDate, maxDate: invLimits.maxDate } : null) : { startDate: "", endDate: "" },
    [dataSource, timeWindow, invLimits?.minDate, invLimits?.maxDate, customRange]
  )
  const invActiveCustomer = dataSource === "invoice" && customerFilter !== "all" ? customerFilter : undefined
  const invActiveSalesRep = dataSource === "invoice" && salesRepFilter !== "all" ? salesRepFilter : undefined
  const invActiveSpec = dataSource === "invoice" && specFilter !== "all" ? specFilter : undefined

  const invDetailRange = useMemo(() => {
    if (dataSource !== "invoice") return { start: "", end: "" }
    if (!selectedPeriod) return { start: invTimeRange.startDate, end: invTimeRange.endDate }
    if (chartTab === "calendar" && selectedPeriod.length === 10) {
      return { start: selectedPeriod, end: formatDateISO(addDays(parseISODate(selectedPeriod), 1)) }
    }
    const range = getPeriodRange(selectedPeriod, granularity)
    return { start: range.startDate, end: range.endDate }
  }, [dataSource, selectedPeriod, invTimeRange, granularity, chartTab])

  const invCalendarRange = useMemo(() => dataSource === "invoice" ? getMonthDateRange(calendarMonth) : { startDate: "", endDate: "" }, [dataSource, calendarMonth])

  const invSummaryQuery = useInvoiceCostVarianceSummary(invTimeRange.startDate, invTimeRange.endDate, granularity, invActiveCustomer, invActiveSalesRep, invActiveSpec)
  const invDetailsQuery = useInvoiceCostVarianceDetails(invDetailRange.start, invDetailRange.end, detailPage, DETAIL_PAGE_SIZE, activeSort.key, activeSort.dir, invActiveCustomer, invActiveSalesRep, invActiveSpec)
  const invFilterOptionsQuery = useInvoiceCostVarianceFilterOptions(invTimeRange.startDate, invTimeRange.endDate, invActiveCustomer, invActiveSalesRep, invActiveSpec)
  const invCalendarQuery = useInvoiceCostVarianceSummary(invCalendarRange.startDate, invCalendarRange.endDate, "daily", invActiveCustomer, invActiveSalesRep, invActiveSpec)

  // ---- Select active data based on dataSource ----
  const summaryQuery = dataSource === "production" ? prodSummaryQuery : invSummaryQuery
  const detailsQuery = dataSource === "production" ? prodDetailsQuery : invDetailsQuery
  const filterOptionsQuery = dataSource === "production" ? prodFilterOptionsQuery : invFilterOptionsQuery
  const calendarQuery = dataSource === "production" ? prodCalendarQuery : invCalendarQuery

  const summaryData = summaryQuery.data?.data ?? []
  const detailPagination = detailsQuery.data?.pagination
  const serverTotals = detailsQuery.data?.totals
  const hasMoreDetail = detailPagination ? detailPagination.page < detailPagination.totalPages : false
  hasMoreDetailRef.current = hasMoreDetail
  isFetchingDetailRef.current = detailsQuery.isFetching
  const filterOptions = filterOptionsQuery.data?.data
  const calendarDailyData = calendarQuery.data?.data ?? []

  // Reset selectedPeriod when filters change
  useEffect(() => {
    setSelectedPeriod(null)
  }, [timeWindow, lineFilter, customerFilter, salesRepFilter, specFilter, jobFilter, granularity, calendarMonth, dataSource])

  // Reset detail pagination when filters/range/sort change
  useEffect(() => {
    setDetailPage(1)
    setAllDetailData([])
    lastLoadedPageRef.current = 0
  }, [dataSource, timeWindow, customStart, customEnd, selectedPeriod, granularity, calendarMonth, lineFilter, customerFilter, salesRepFilter, specFilter, jobFilter, activeSort.key, activeSort.dir])

  // Accumulate detail rows across pages
  useEffect(() => {
    if (detailsQuery.isPlaceholderData) return
    const rows = detailsQuery.data?.data
    const pg = detailsQuery.data?.pagination
    if (!rows || !pg) return
    if (pg.page === 1) {
      setAllDetailData(rows)
      lastLoadedPageRef.current = 1
    } else if (pg.page > lastLoadedPageRef.current) {
      setAllDetailData(prev => [...prev, ...rows])
      lastLoadedPageRef.current = pg.page
    }
  }, [detailsQuery.data, detailsQuery.isPlaceholderData])

  // Scroll listener for detail table infinite loading
  useEffect(() => {
    const container = detailScrollRef.current
    if (!container) return
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      if (scrollHeight - scrollTop - clientHeight < 200 && hasMoreDetailRef.current && !isFetchingDetailRef.current) {
        setDetailPage(prev => prev + 1)
      }
    }
    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [detailsQuery.isFetching, allDetailData.length])

  // ---- Derived chart data ----
  const isHoursMode = dataSource === "production" && (costType === "hours-order" || costType === "hours-uptime")

  const calendarMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of calendarDailyData) {
      if (isHoursMode) {
        const estH = toNumber(row.estimatedHours)
        const actH = costType === "hours-order" ? toNumber((row as unknown as Record<string, unknown>).orderHours) : toNumber((row as unknown as Record<string, unknown>).uptimeHours)
        map.set(row.period, estH - actH)
      } else {
        let est: number, act: number
        if (costType === "full") {
          est = toNumber(row.estMaterialCost) + toNumber(row.estLaborCost) + toNumber(row.estFreightCost)
          act = toNumber(row.actMaterialCost) + toNumber(row.actLaborCost) + toNumber(row.actFreightCost)
        } else {
          const eKey = costType === "material" ? "estMaterialCost" : costType === "labor" ? "estLaborCost" : "estFreightCost"
          const aKey = costType === "material" ? "actMaterialCost" : costType === "labor" ? "actLaborCost" : "actFreightCost"
          est = toNumber(row[eKey])
          act = toNumber(row[aKey])
        }
        map.set(row.period, est - act)
      }
    }
    return map
  }, [calendarDailyData, costType, isHoursMode])

  const calendarMaxAbs = useMemo(() => {
    let max = 0
    for (const v of calendarMap.values()) { if (Math.abs(v) > max) max = Math.abs(v) }
    return max
  }, [calendarMap])

  const chartData = useMemo(() => {
    return summaryData.map((row) => {
      const estMaterial = toNumber(row.estMaterialCost)
      const estLabor = toNumber(row.estLaborCost)
      const estFreight = toNumber(row.estFreightCost)
      const actMaterial = toNumber(row.actMaterialCost)
      const actLabor = toNumber(row.actLaborCost)
      const actFreight = toNumber(row.actFreightCost)
      return {
        periodKey: row.period,
        label: getPeriodLabel(row.period, granularity),
        estMaterial, estLabor, estFreight,
        estFull: estMaterial + estLabor,
        actMaterial, actLabor, actFreight,
        actFull: actMaterial + actLabor,
        orderHours: toNumber((row as unknown as Record<string, unknown>).orderHours),
        uptimeHours: toNumber((row as unknown as Record<string, unknown>).uptimeHours),
        estimatedHours: toNumber(row.estimatedHours),
      }
    })
  }, [summaryData, granularity])

  const estKey = isHoursMode ? "estimatedHours" : costType === "full" ? "estFull" : costType === "material" ? "estMaterial" : "estLabor"
  const actKey = costType === "hours-order" ? "orderHours" : costType === "hours-uptime" ? "uptimeHours" : costType === "full" ? "actFull" : costType === "material" ? "actMaterial" : "actLabor"
  const costLabel = costType === "hours-order" ? "vs Order Hrs" : costType === "hours-uptime" ? "vs Uptime" : costType === "full" ? "Full" : costType === "material" ? "Material" : "Labor"

  // ---- Detail rows ----
  const detailRows = useMemo(() => {
    return allDetailData.map((row: Record<string, unknown>) => {
      const dateField = cfg.dateField as string
      const dateRaw = String((row as unknown as Record<string, unknown>)[dateField] ?? "")
      const estMat = toNumber(row.estMaterialCost)
      const estLab = toNumber(row.estLaborCost)
      const estFrt = toNumber(row.estFreightCost)
      const actMat = toNumber(row.actMaterialCost)
      const actLab = toNumber(row.actLaborCost)
      const actFrt = toNumber(row.actFreightCost)
      const r = row as unknown as Record<string, unknown>
      return {
        date: formatDashboardDate(dateRaw),
        dateSort: getDashboardDateSortKey(dateRaw),
        invoiceNumber: String(r.invoiceNumber ?? ""),
        jobNumber: String(r.jobNumber ?? ""),
        customerName: String(r.customerName ?? ""),
        specNumber: String(r.specNumber ?? ""),
        lineNumber: String(r.lineNumber ?? ""),
        quantity: toNumber(r.quantity),
        estMaterialCost: estMat,
        estLaborCost: estLab,
        estFreightCost: estFrt,
        actMaterialCost: actMat,
        actLaborCost: actLab,
        actFreightCost: actFrt,
        estFull: estMat + estLab,
        actFull: actMat + actLab,
        variance: (estMat + estLab) - (actMat + actLab),
        materialVariance: estMat - actMat,
        laborVariance: estLab - actLab,
        orderHours: toNumber(r.orderHours),
        uptimeHours: toNumber(r.uptimeHours),
        estHours: toNumber(r.estimatedHours),
        hoursVariance: toNumber(r.orderHours) - toNumber(r.estimatedHours),
        vsUptime: toNumber(r.uptimeHours) - toNumber(r.estimatedHours),
        adjQty: toNumber(r.adjQty),
        stdRunRate: toNumber(r.stdRunRate),
        setupMins: toNumber(r.setupMins),
        numberOut: toNumber(r.numberOut) || 1,
      }
    })
  }, [allDetailData, cfg.dateField])

  // Map dateField dim names to the unified "date" key used in detailRows
  const dateFieldDim = cfg.dateField

  const groupedDetailRows = useMemo(() => {
    const allDims = cfg.groupByOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return detailRows

    const grouped = new Map<string, typeof detailRows[number]>()
    for (const row of detailRows) {
      const keyParts = activeDims.map((d) => {
        if (d === dateFieldDim) return row.date
        // Map dim key to the unified detail row property name
        const propMap: Record<string, string> = { invoiceNumber: "invoiceNumber", jobNumber: "jobNumber", customerName: "customerName", specNumber: "specNumber", lineNumber: "lineNumber" }
        return (row as unknown as Record<string, unknown>)[propMap[d] ?? d] as string
      })
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          ...row,
          date: activeDims.includes(dateFieldDim) ? row.date : "",
          dateSort: activeDims.includes(dateFieldDim) ? row.dateSort : "",
          invoiceNumber: activeDims.includes("invoiceNumber") ? row.invoiceNumber : "",
          jobNumber: activeDims.includes("jobNumber") ? row.jobNumber : "",
          customerName: activeDims.includes("customerName") ? row.customerName : "",
          specNumber: activeDims.includes("specNumber") ? row.specNumber : "",
          lineNumber: activeDims.includes("lineNumber") ? row.lineNumber : "",
        })
      } else {
        existing.estMaterialCost += row.estMaterialCost
        existing.estLaborCost += row.estLaborCost
        existing.estFreightCost += row.estFreightCost
        existing.actMaterialCost += row.actMaterialCost
        existing.actLaborCost += row.actLaborCost
        existing.actFreightCost += row.actFreightCost
        existing.estFull += row.estFull
        existing.actFull += row.actFull
        existing.variance += row.variance
        existing.materialVariance += row.materialVariance
        existing.laborVariance += row.laborVariance
        existing.orderHours += row.orderHours
        existing.uptimeHours += row.uptimeHours
        existing.estHours += row.estHours
        existing.hoursVariance += row.hoursVariance
        existing.vsUptime += row.vsUptime
        existing.adjQty += row.adjQty
        existing.quantity += row.quantity
      }
    }
    return [...grouped.values()]
  }, [detailRows, groupByDims, cfg.groupByOptions, dateFieldDim])

  // Server handles primary sort order; client re-sorts after grouping for display
  const sortRows = useCallback((rows: typeof groupedDetailRows, sort: { key: string; dir: "asc" | "desc" }) => {
    const data = [...rows]
    const key = sort.key as keyof (typeof data)[number]
    const isDateSort = sort.key === dateFieldDim
    data.sort((a, b) => {
      const aVal = isDateSort ? a.dateSort : a[key]
      const bVal = isDateSort ? b.dateSort : b[key]
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      return sort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
    return data
  }, [dateFieldDim])

  const sortedDetailRows = useMemo(() => sortRows(groupedDetailRows, tableSort), [sortRows, groupedDetailRows, tableSort])
  const sortedHoursRows = useMemo(() => sortRows(groupedDetailRows, hoursSort), [sortRows, groupedDetailRows, hoursSort])

  // ---- KPIs ----
  const kpis = useMemo(() => {
    if (chartTab === "calendar" && selectedPeriod && selectedPeriod.length === 10) {
      const dayRow = calendarDailyData.find((d) => d.period === selectedPeriod)
      if (dayRow) {
        const estMat = toNumber(dayRow.estMaterialCost)
        const estLab = toNumber(dayRow.estLaborCost)
        const actMat = toNumber(dayRow.actMaterialCost)
        const actLab = toNumber(dayRow.actLaborCost)
        return {
          estFull: estMat + estLab, actFull: actMat + actLab,
          fullVariance: (estMat + estLab) - (actMat + actLab),
          materialVariance: estMat - actMat, laborVariance: estLab - actLab,
        }
      }
      return { estFull: 0, actFull: 0, fullVariance: 0, materialVariance: 0, laborVariance: 0 }
    }
    const rows = selectedPeriod ? chartData.filter((d) => d.periodKey === selectedPeriod) : chartData
    const estMat = rows.reduce((s, d) => s + d.estMaterial, 0)
    const estLab = rows.reduce((s, d) => s + d.estLabor, 0)
    const actMat = rows.reduce((s, d) => s + d.actMaterial, 0)
    const actLab = rows.reduce((s, d) => s + d.actLabor, 0)
    return {
      estFull: estMat + estLab, actFull: actMat + actLab,
      fullVariance: (estMat + estLab) - (actMat + actLab),
      materialVariance: estMat - actMat, laborVariance: estLab - actLab,
    }
  }, [chartData, selectedPeriod, chartTab, calendarDailyData])

  const detailTotals = useMemo(() => {
    if (!serverTotals) {
      return {
        estMaterialCost: 0, estLaborCost: 0,
        actMaterialCost: 0, actLaborCost: 0,
        materialVariance: 0, laborVariance: 0,
        estFull: 0, actFull: 0, variance: 0,
        orderHours: 0, uptimeHours: 0, estHours: 0,
        hoursVariance: 0, vsUptime: 0,
        adjQty: 0, quantity: 0,
      }
    }
    const t = serverTotals as unknown as Record<string, unknown>
    const estMat = toNumber(t.estMaterialCost)
    const estLab = toNumber(t.estLaborCost)
    const actMat = toNumber(t.actMaterialCost)
    const actLab = toNumber(t.actLaborCost)
    const estFull = estMat + estLab
    const actFull = actMat + actLab
    const orderHours = toNumber(t.orderHours)
    const uptimeHours = toNumber(t.uptimeHours)
    const estHours = toNumber(t.estimatedHours)
    return {
      estMaterialCost: estMat, estLaborCost: estLab,
      actMaterialCost: actMat, actLaborCost: actLab,
      materialVariance: estMat - actMat, laborVariance: estLab - actLab,
      estFull, actFull, variance: estFull - actFull,
      orderHours, uptimeHours, estHours,
      hoursVariance: orderHours - estHours,
      vsUptime: uptimeHours - estHours,
      adjQty: toNumber(t.adjQty),
      quantity: toNumber(t.quantity),
    }
  }, [serverTotals])

  // ---- Chart interactions ----
  const dimRegions = useMemo(() => {
    if (!selectedPeriod || chartData.length === 0) return null
    const idx = chartData.findIndex((d) => d.periodKey === selectedPeriod)
    if (idx < 0) return null
    const labels = chartData.map((d) => d.label)
    return {
      left: idx > 0 ? { x1: labels[0], x2: labels[idx - 1] } : null,
      right: idx < labels.length - 1 ? { x1: labels[idx + 1], x2: labels[labels.length - 1] } : null,
    }
  }, [selectedPeriod, chartData])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = useCallback((data: any) => {
    let periodKey = data?.activePayload?.[0]?.payload?.periodKey as string | undefined
    if (!periodKey && data?.activeLabel) {
      const match = chartData.find((d) => d.label === data.activeLabel)
      if (match) periodKey = match.periodKey
    }
    if (!periodKey) return
    setSelectedPeriod((prev) => (prev === periodKey ? null : periodKey))
  }, [chartData])

  const handleSort = useCallback((key: string) => {
    setTableSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }))
  }, [setTableSort])

  const handleHoursSort = useCallback((key: string) => {
    setHoursSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }))
  }, [setHoursSort])

  const resetFilters = useCallback(() => {
    setTimeWindow("ytd")
    setGranularity("daily")
    setCostType("full")
    setLineFilter("all")
    setCustomerFilter("all")
    setSalesRepFilter("all")
    setSpecFilter("all")
    setJobFilter("all")
    setTableSort({ key: cfg.defaultSortKey, dir: "desc" })
    setHoursSort({ key: cfg.defaultSortKey, dir: "desc" })
    setSelectedPeriod(null)
    setDetailPage(1)
    setAllDetailData([])
    lastLoadedPageRef.current = 0
  }, [cfg.defaultSortKey, setCostType, setCustomerFilter, setGranularity, setJobFilter, setLineFilter, setSpecFilter, setTableSort, setHoursSort, setTimeWindow])

  const maxVisiblePoints = 16
  const needsScroll = chartData.length > maxVisiblePoints
  const chartWidth = needsScroll ? chartData.length * 70 : undefined

  useEffect(() => {
    if (needsScroll && chartScrollRef.current) {
      chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth
    }
  }, [needsScroll, chartData.length])

  const isLoading = summaryQuery.isLoading || detailsQuery.isLoading || filterOptionsQuery.isLoading
  const queryError = summaryQuery.error || detailsQuery.error

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: [cfg.queryInvalidationKey] })
      setLastUpdated(new Date())
    } finally {
      setIsRefreshing(false)
    }
  }, [queryClient, cfg.queryInvalidationKey])

  useEffect(() => {
    if (!lastUpdated && !summaryQuery.isLoading && summaryData.length > 0) {
      setLastUpdated(new Date())
    }
  }, [lastUpdated, summaryQuery.isLoading, summaryData.length])

  const sortIndicator = (key: string) => tableSort.key === key ? (tableSort.dir === "asc" ? " \u2191" : " \u2193") : ""
  const hoursSortIndicator = (key: string) => hoursSort.key === key ? (hoursSort.dir === "asc" ? " \u2191" : " \u2193") : ""

  // Map group-by dim names to unified detail row property names
  const dimToProp = (dim: string): keyof typeof detailRows[number] => {
    if (dim === "feedbackDate" || dim === "invoiceDate") return "date"
    return dim as keyof typeof detailRows[number]
  }

  const perM = useCallback((cost: number, qty: number) => {
    if (!costPer1000 || qty === 0) return cost
    return cost / qty * 1000
  }, [costPer1000])

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 -mx-6 -mt-6 pt-3 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate(cfg.backRoute)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">Cost Variance</span>

        {/* Data source tabs */}
        <div className="flex items-center gap-0.5 ml-1">
          {([["production", "Production"], ["invoice", "Invoice"]] as [DataSource, string][]).map(([src, label]) => (
            <Button
              key={src}
              variant={dataSource === src ? "default" : "outline"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setDataSource(src)}
            >
              {label}
            </Button>
          ))}
        </div>

        <span className="mx-1 text-border">|</span>

        <Select value={timeWindow} onValueChange={(v) => setTimeWindow(v as CVTimeWindow)}>
          <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs gap-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CV_TIME_PRESETS.map((preset) => (
              <SelectItem key={preset.key} value={preset.key}>{preset.label}</SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <DateRangePicker
          startDate={customRange?.startDate}
          endDate={customRange?.endDate}
          onChange={(start, end) => { setCustomStart(start); setCustomEnd(end); setTimeWindow("custom") }}
        >
          <Button
            variant={timeWindow === "custom" ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs gap-1"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {timeWindow === "custom" && customRange
              ? `${customRange.startDate} – ${customRange.endDate}`
              : "Pick"}
          </Button>
        </DateRangePicker>

        <div className="ml-auto flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs gap-1.5 relative">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {(() => {
                  const count = (lineFilter !== "all" ? 1 : 0) + (customerFilter !== "all" ? 1 : 0) + (salesRepFilter !== "all" ? 1 : 0) + (specFilter !== "all" ? 1 : 0) + (jobFilter !== "all" ? 1 : 0)
                  return count > 0 ? <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-medium">{count}</span> : null
                })()}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3 bg-[var(--color-bg-secondary)]" align="end">
              {cfg.hasLineFilter && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Line</label>
                  <SearchableSelect
                    value={lineFilter}
                    onValueChange={setLineFilter}
                    options={(filterOptions as unknown as Record<string, unknown>)?.lineNumbers as string[] ?? []}
                    placeholder="All Lines"
                    searchPlaceholder="Search lines..."
                    width="w-full"
                    popoverWidth="w-[248px]"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Customer</label>
                <SearchableSelect
                  value={customerFilter}
                  onValueChange={setCustomerFilter}
                  options={(filterOptions as unknown as Record<string, unknown>)?.customers as string[] ?? []}
                  placeholder="All Customers"
                  searchPlaceholder="Search customers..."
                  width="w-full"
                  popoverWidth="w-[248px]"
                />
              </div>
              {dataSource === "invoice" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Sales Rep</label>
                  <SearchableSelect
                    value={salesRepFilter}
                    onValueChange={setSalesRepFilter}
                    options={(filterOptions as unknown as Record<string, unknown>)?.salesReps as string[] ?? []}
                    placeholder="All Sales Reps"
                    searchPlaceholder="Search sales reps..."
                    width="w-full"
                    popoverWidth="w-[248px]"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Spec</label>
                <SearchableSelect
                  value={specFilter}
                  onValueChange={setSpecFilter}
                  options={(filterOptions as unknown as Record<string, unknown>)?.specs as string[] ?? []}
                  placeholder="All Specs"
                  searchPlaceholder="Search specs..."
                  width="w-full"
                  popoverWidth="w-[248px]"
                />
              </div>
              {dataSource === "production" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Job</label>
                  <SearchableSelect
                    value={jobFilter}
                    onValueChange={setJobFilter}
                    options={(filterOptions as unknown as Record<string, unknown>)?.jobs as string[] ?? []}
                    placeholder="All Jobs"
                    searchPlaceholder="Search jobs..."
                    width="w-full"
                    popoverWidth="w-[248px]"
                  />
                </div>
              )}
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={resetFilters}>
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset Filters
              </Button>
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefresh} disabled={isRefreshing} title="Refresh data">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
          {lastUpdated && (
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              Last refreshed {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {queryError && (
        <div className="rounded-md border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-600 dark:text-red-400">
          Failed to load data: {(queryError as Error).message ?? "Unknown error"}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="Est Full Cost" value={formatCurrency(kpis.estFull)} tooltip="Sum of estimated material + labor" />
        <KpiCard title="Act Full Cost" value={formatCurrency(kpis.actFull)} tooltip="Sum of actual material + labor" />
        <KpiCard title="Full Variance" value={formatCurrency(kpis.fullVariance)} color={varianceColor(kpis.fullVariance)} tooltip="Estimated - Actual (positive = under budget)" />
        <KpiCard title="Material Var" value={formatCurrency(kpis.materialVariance)} color={varianceColor(kpis.materialVariance)} />
        <KpiCard title="Labor Var" value={formatCurrency(kpis.laborVariance)} color={varianceColor(kpis.laborVariance)} />
      </div>

      {/* Chart Card */}
      <Card className="bg-background-secondary">
        <Tabs value={chartTab} onValueChange={(value) => { setChartTab(value as ChartTab); setSelectedPeriod(null) }}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <CardTitle className="text-base">{cfg.chartTitle}</CardTitle>
                <TabsList>
                  <TabsTrigger value="calendar">Calendar</TabsTrigger>
                  <TabsTrigger value="area">Area</TabsTrigger>
                </TabsList>
                {chartTab === "calendar" && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth((m) => shiftMonth(m, -1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium min-w-[140px] text-center">{getMonthLabel(calendarMonth)}</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalendarMonth((m) => shiftMonth(m, 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {chartTab === "area" && (
                  <Select value={granularity} onValueChange={(v) => setGranularity(v as CostVarianceGranularity)}>
                    <SelectTrigger className="h-7 w-auto min-w-[90px] text-xs gap-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yearly">Yearly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Select value={costType} onValueChange={(v) => setCostType(v as CostType)}>
                  <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs gap-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full</SelectItem>
                    <SelectItem value="material">Material</SelectItem>
                    <SelectItem value="labor">Labor</SelectItem>
                    {cfg.hasHoursMode && (
                      <>
                        <SelectItem value="hours-order">vs Order Hrs</SelectItem>
                        <SelectItem value="hours-uptime">vs Uptime</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {chartTab === "calendar"
                ? isHoursMode
                  ? `Daily hours variance heat map (Est - ${costType === "hours-order" ? "Order" : "Uptime"})`
                  : `Daily ${costLabel} cost variance heat map (Est - Act)`
                : isHoursMode
                  ? `Estimated vs ${costType === "hours-order" ? "Order" : "Uptime"} hours by period`
                  : dataSource === "invoice"
                    ? `Estimated vs Actual ${costLabel} cost by invoice date`
                    : `Estimated vs Actual ${costLabel} cost by period`}
            </p>
          </CardHeader>
          <CardContent>
            {(chartTab === "area" && summaryQuery.isLoading) || (chartTab === "calendar" && calendarQuery.isLoading) ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <>
              <TabsContent value="area" className="mt-0">
                <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                  <div style={needsScroll ? { width: chartWidth } : undefined}>
                    <ResponsiveContainer width="100%" height={300}>
                      <AreaChart
                        data={chartData}
                        margin={{ top: 20, left: 40, right: 30, bottom: 5 }}
                        onClick={handleChartClick}
                        style={{ cursor: "pointer" }}
                      >
                        <defs>
                          <linearGradient id={cfg.gradientIdEst} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                          </linearGradient>
                          <linearGradient id={cfg.gradientIdAct} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="label" className="text-xs" tickLine={false} />
                        <YAxis tickFormatter={(v) => isHoursMode ? `${formatNumber(v, 0)}h` : formatCompact(v)} className="text-xs" />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [isHoursMode ? `${formatNumber(value, 1)} hrs` : formatCurrencyDetail(value), name]) as any}
                          contentStyle={{
                            backgroundColor: "var(--color-bg-secondary)",
                            borderColor: "var(--border)",
                            borderRadius: 8,
                          }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                        />
                        {dimRegions?.left && (
                          <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />
                        )}
                        {dimRegions?.right && (
                          <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />
                        )}
                        <Area
                          type="monotone"
                          dataKey={estKey}
                          name={isHoursMode ? "Estimated" : `Est ${costLabel}`}
                          stroke="#6366f1"
                          fill={`url(#${cfg.gradientIdEst})`}
                          strokeWidth={2.5}
                          dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                        <Area
                          type="monotone"
                          dataKey={actKey}
                          name={isHoursMode ? (costType === "hours-order" ? "Order Hours" : "Uptime") : `Act ${costLabel}`}
                          stroke="#a78bfa"
                          fill={`url(#${cfg.gradientIdAct})`}
                          strokeWidth={2.5}
                          strokeDasharray="5 5"
                          dot={{ r: 4, fill: "#a78bfa", stroke: "var(--color-bg)", strokeWidth: 2 }}
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-0.5 bg-[#6366f1]" />
                    Estimated
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-4 h-0.5 bg-[#a78bfa]" style={{ borderTop: "2px dashed #a78bfa", height: 0 }} />
                    {isHoursMode ? (costType === "hours-order" ? "Order Hours" : "Uptime") : "Actual"}
                  </span>
                </div>
              </TabsContent>
              <TabsContent value="calendar" className="mt-0">
                <div className="w-full">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                          <th key={d} className="text-xs font-medium text-muted-foreground py-1 text-center w-[14.28%]">{d}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {getCalendarGrid(calendarMonth).map((week, wi) => (
                        <tr key={wi}>
                          {week.map((cell, ci) => {
                            if (cell.date === 0) return <td key={ci} className="p-0.5"><div className="h-[52px] rounded border border-border/30 bg-muted/10" /></td>
                            const value = calendarMap.get(cell.key) ?? 0
                            const { bg, textColor } = getVarianceHeatColor(value, calendarMaxAbs)
                            const isSelected = selectedPeriod === cell.key
                            return (
                              <td key={ci} className="p-0.5">
                                <div
                                  className={`h-[52px] rounded border border-border/30 cursor-pointer flex flex-col items-center justify-center relative transition-shadow ${
                                    isSelected ? "ring-2 ring-primary ring-offset-1" : ""
                                  }`}
                                  style={{ backgroundColor: value !== 0 ? bg : undefined }}
                                  onClick={() => setSelectedPeriod((prev) => prev === cell.key ? null : cell.key)}
                                >
                                  <span className="absolute top-0.5 right-1.5 text-[10px] leading-none" style={{ color: value !== 0 ? textColor : "var(--color-text-muted)" }}>
                                    {cell.date}
                                  </span>
                                  {value !== 0 && (
                                    <span className="text-xs font-semibold mt-1" style={{ color: textColor }}>
                                      {isHoursMode ? `${formatNumber(value, 1)}h` : formatCompact(value)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
              </>
            )}
          </CardContent>
        </Tabs>
      </Card>

      {/* Detail Table */}
      <Card className="bg-background-secondary">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base">Detail</CardTitle>
              <div className="flex items-center gap-0.5">
                {(["costs", "hours"] as DetailTab[]).map((tab) => (
                  <Button
                    key={tab}
                    variant={detailTab === tab ? "default" : "outline"}
                    size="sm"
                    className="h-7 px-3 text-xs capitalize"
                    onClick={() => setDetailTab(tab)}
                  >
                    {tab}
                  </Button>
                ))}
              </div>
              {detailTab === "costs" && (
                <Button
                  variant={costPer1000 ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => setCostPer1000((prev) => !prev)}
                >
                  Per 1000
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-1">Group by:</span>
              {cfg.groupByOptions.map(([dim, label]) => (
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {detailTab === "costs" ? (
          <div ref={detailScrollRef} className="relative overflow-x-auto max-h-[400px] overflow-y-auto [&>div]:!overflow-visible [&_td]:py-1.5 [&_th]:py-1.5 [&_tfoot_td]:sticky [&_tfoot_td]:bottom-[-1px] [&_tfoot_td]:z-20 [&_tfoot_td]:bg-[var(--color-bg-secondary)]">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]">
                <TableRow>
                  {cfg.groupByOptions.map(([dim, label]) =>
                    groupByDims.includes(dim) ? (
                      <TableHead key={dim} className="cursor-pointer hover:text-foreground" onClick={() => handleSort(dim)}>
                        {label}{sortIndicator(dim)}
                      </TableHead>
                    ) : null
                  )}
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort(dataSource === "production" ? "adjQty" : "quantity")}>
                    Qty{sortIndicator(dataSource === "production" ? "adjQty" : "quantity")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("numberOut")}>
                    # Out{sortIndicator("numberOut")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("estMaterialCost")}>
                    Est Mat{sortIndicator("estMaterialCost")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("actMaterialCost")}>
                    Act Mat{sortIndicator("actMaterialCost")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("materialVariance")}>
                    Mat Var{sortIndicator("materialVariance")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("estLaborCost")}>
                    Est Lab{sortIndicator("estLaborCost")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("actLaborCost")}>
                    Act Lab{sortIndicator("actLaborCost")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("laborVariance")}>
                    Lab Var{sortIndicator("laborVariance")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("estFull")}>
                    Est Full{sortIndicator("estFull")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("actFull")}>
                    Act Full{sortIndicator("actFull")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("variance")}>
                    Variance{sortIndicator("variance")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDetailRows.map((row, idx) => {
                  const q = dataSource === "production" ? row.adjQty : row.quantity
                  const mVar = perM(row.materialVariance, q)
                  const lVar = perM(row.laborVariance, q)
                  const fVar = perM(row.variance, q)
                  return (
                  <TableRow key={`${row.date}-${row.jobNumber}-${row.lineNumber}-${row.invoiceNumber}-${idx}`}>
                    {cfg.groupByOptions.map(([dim]) =>
                      groupByDims.includes(dim) ? (
                        <TableCell key={dim} className={dim === dateFieldDim ? "font-medium" : dim === "customerName" ? "max-w-[180px] truncate" : ""}>
                          {String(row[dimToProp(dim)] ?? "")}
                        </TableCell>
                      ) : null
                    )}
                    <TableCell className="text-right">{formatNumber(q, 0)}</TableCell>
                    <TableCell className="text-right">{row.numberOut}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(row.estMaterialCost, q))}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(row.actMaterialCost, q))}</TableCell>
                    <TableCell className={`text-right ${mVar > 0 ? "text-emerald-600 dark:text-emerald-400" : mVar < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCurrencyDetail(mVar)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(row.estLaborCost, q))}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(row.actLaborCost, q))}</TableCell>
                    <TableCell className={`text-right ${lVar > 0 ? "text-emerald-600 dark:text-emerald-400" : lVar < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCurrencyDetail(lVar)}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatCurrencyDetail(perM(row.estFull, q))}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrencyDetail(perM(row.actFull, q))}</TableCell>
                    <TableCell className={`text-right font-medium ${fVar > 0 ? "text-emerald-600 dark:text-emerald-400" : fVar < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCurrencyDetail(fVar)}
                    </TableCell>
                  </TableRow>
                  )
                })}
                {sortedDetailRows.length === 0 && !isLoading && !detailsQuery.isFetching && (
                  <TableRow>
                    <TableCell colSpan={99} className="text-center text-muted-foreground py-8">
                      No cost variance detail rows for this selection
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {sortedDetailRows.length > 0 && (() => {
                const tq = dataSource === "production" ? detailTotals.adjQty : detailTotals.quantity
                const tmVar = perM(detailTotals.materialVariance, tq)
                const tlVar = perM(detailTotals.laborVariance, tq)
                const tfVar = perM(detailTotals.variance, tq)
                return (
                <TableFooter>
                  <TableRow className="font-semibold border-t">
                    <TableCell colSpan={groupByDims.length || 1}>{costPer1000 ? "Avg /M" : "Total"}</TableCell>
                    <TableCell className="text-right">{formatNumber(tq, 0)}</TableCell>
                    <TableCell />
                    <TableCell className="text-right">{formatCurrencyDetail(perM(detailTotals.estMaterialCost, tq))}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(detailTotals.actMaterialCost, tq))}</TableCell>
                    <TableCell className={`text-right ${tmVar > 0 ? "text-emerald-600 dark:text-emerald-400" : tmVar < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCurrencyDetail(tmVar)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(detailTotals.estLaborCost, tq))}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(detailTotals.actLaborCost, tq))}</TableCell>
                    <TableCell className={`text-right ${tlVar > 0 ? "text-emerald-600 dark:text-emerald-400" : tlVar < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCurrencyDetail(tlVar)}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(detailTotals.estFull, tq))}</TableCell>
                    <TableCell className="text-right">{formatCurrencyDetail(perM(detailTotals.actFull, tq))}</TableCell>
                    <TableCell className={`text-right ${tfVar > 0 ? "text-emerald-600 dark:text-emerald-400" : tfVar < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatCurrencyDetail(tfVar)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
                )
              })()}
            </Table>
          </div>
          ) : dataSource === "production" ? (
          /* Production hours table */
          <div ref={detailScrollRef} className="relative overflow-x-auto max-h-[400px] overflow-y-auto [&>div]:!overflow-visible [&_td]:py-1.5 [&_th]:py-1.5 [&_tfoot_td]:sticky [&_tfoot_td]:bottom-[-1px] [&_tfoot_td]:z-20 [&_tfoot_td]:bg-[var(--color-bg-secondary)]">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]">
                <TableRow>
                  {cfg.groupByOptions.map(([dim, label]) =>
                    groupByDims.includes(dim) ? (
                      <TableHead key={dim} className="cursor-pointer hover:text-foreground" onClick={() => handleHoursSort(dim)}>
                        {label}{hoursSortIndicator(dim)}
                      </TableHead>
                    ) : null
                  )}
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("adjQty")}>
                    Adj Qty{hoursSortIndicator("adjQty")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("stdRunRate")}>
                    Run Rate{hoursSortIndicator("stdRunRate")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("setupMins")}>
                    Setup Min{hoursSortIndicator("setupMins")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("estHours")}>
                    Est Hours{hoursSortIndicator("estHours")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("orderHours")}>
                    Order Hours{hoursSortIndicator("orderHours")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("uptimeHours")}>
                    Uptime{hoursSortIndicator("uptimeHours")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("hoursVariance")}>
                    vs Order{hoursSortIndicator("hoursVariance")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("vsUptime")}>
                    vs Uptime{hoursSortIndicator("vsUptime")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedHoursRows.map((row, idx) => (
                  <TableRow key={`h-${row.date}-${row.jobNumber}-${row.lineNumber}-${idx}`}>
                    {cfg.groupByOptions.map(([dim]) =>
                      groupByDims.includes(dim) ? (
                        <TableCell key={dim} className={dim === dateFieldDim ? "font-medium" : dim === "customerName" ? "max-w-[180px] truncate" : ""}>
                          {String(row[dimToProp(dim)] ?? "")}
                        </TableCell>
                      ) : null
                    )}
                    <TableCell className="text-right">{formatNumber(row.adjQty, 0)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.stdRunRate, 0)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.setupMins, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.estHours, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.orderHours, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.uptimeHours, 1)}</TableCell>
                    <TableCell className={`text-right font-medium ${row.hoursVariance < 0 ? "text-emerald-600 dark:text-emerald-400" : row.hoursVariance > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatNumber(row.hoursVariance, 1)}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${row.vsUptime < 0 ? "text-emerald-600 dark:text-emerald-400" : row.vsUptime > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatNumber(row.vsUptime, 1)}
                    </TableCell>
                  </TableRow>
                ))}
                {sortedHoursRows.length === 0 && !isLoading && !detailsQuery.isFetching && (
                  <TableRow>
                    <TableCell colSpan={99} className="text-center text-muted-foreground py-8">
                      No hours detail rows for this selection
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {sortedHoursRows.length > 0 && (
                <TableFooter>
                  <TableRow className="font-semibold border-t">
                    <TableCell colSpan={groupByDims.length || 1}>Total</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.adjQty, 0)}</TableCell>
                    <TableCell className="text-right"></TableCell>
                    <TableCell className="text-right"></TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.estHours, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.orderHours, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.uptimeHours, 1)}</TableCell>
                    <TableCell className={`text-right ${detailTotals.hoursVariance < 0 ? "text-emerald-600 dark:text-emerald-400" : detailTotals.hoursVariance > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatNumber(detailTotals.hoursVariance, 1)}
                    </TableCell>
                    <TableCell className={`text-right ${detailTotals.vsUptime < 0 ? "text-emerald-600 dark:text-emerald-400" : detailTotals.vsUptime > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatNumber(detailTotals.vsUptime, 1)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
          ) : (
          /* Invoice hours table */
          <div ref={detailScrollRef} className="relative overflow-x-auto max-h-[400px] overflow-y-auto [&>div]:!overflow-visible [&_td]:py-1.5 [&_th]:py-1.5 [&_tfoot_td]:sticky [&_tfoot_td]:bottom-[-1px] [&_tfoot_td]:z-20 [&_tfoot_td]:bg-[var(--color-bg-secondary)]">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]">
                <TableRow>
                  {cfg.groupByOptions.map(([dim, label]) =>
                    groupByDims.includes(dim) ? (
                      <TableHead key={dim} className="cursor-pointer hover:text-foreground" onClick={() => handleHoursSort(dim)}>
                        {label}{hoursSortIndicator(dim)}
                      </TableHead>
                    ) : null
                  )}
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("quantity")}>
                    Qty{hoursSortIndicator("quantity")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("stdRunRate")}>
                    Run Rate{hoursSortIndicator("stdRunRate")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("setupMins")}>
                    Setup Min{hoursSortIndicator("setupMins")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleHoursSort("estHours")}>
                    Est Hours{hoursSortIndicator("estHours")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedHoursRows.map((row, idx) => (
                  <TableRow key={`h-${row.date}-${row.invoiceNumber}-${row.jobNumber}-${idx}`}>
                    {cfg.groupByOptions.map(([dim]) =>
                      groupByDims.includes(dim) ? (
                        <TableCell key={dim} className={dim === dateFieldDim ? "font-medium" : dim === "customerName" ? "max-w-[180px] truncate" : ""}>
                          {String(row[dimToProp(dim)] ?? "")}
                        </TableCell>
                      ) : null
                    )}
                    <TableCell className="text-right">{formatNumber(row.quantity, 0)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.stdRunRate, 0)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.setupMins, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.estHours, 1)}</TableCell>
                  </TableRow>
                ))}
                {sortedHoursRows.length === 0 && !isLoading && !detailsQuery.isFetching && (
                  <TableRow>
                    <TableCell colSpan={99} className="text-center text-muted-foreground py-8">
                      No hours detail rows for this selection
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
              {sortedHoursRows.length > 0 && (
                <TableFooter>
                  <TableRow className="font-semibold border-t">
                    <TableCell colSpan={groupByDims.length || 1}>Total</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.quantity, 0)}</TableCell>
                    <TableCell className="text-right"></TableCell>
                    <TableCell className="text-right"></TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.estHours, 1)}</TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
          )}
          {detailsQuery.isFetching && allDetailData.length > 0 && (
            <div className="py-2 text-center text-sm text-muted-foreground">Loading more...</div>
          )}
          {allDetailData.length > 0 && detailPagination && (
            <div className="flex items-center border-t border-border px-3 py-1.5">
              <p className="text-xs text-muted-foreground">
                Showing {allDetailData.length} of {detailPagination.total} rows
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
