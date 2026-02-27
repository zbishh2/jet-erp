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
  LabelList,
  ReferenceArea,
  BarChart,
  Bar,
  Cell,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { ArrowLeft, RotateCcw, RefreshCw, Info, ChevronLeft, ChevronRight } from "lucide-react"
import {
  useSqFtDateLimits,
  useSqFtSummary,
  useSqFtByLine,
  useSqFtDetails,
  useSqFtFilterOptions,
} from "@/api/hooks/useSqFtDashboard"
import type { SqFtGranularity } from "@/api/hooks/useSqFtDashboard"
import { TimePresetBar } from "@/components/ui/time-preset-bar"
import {
  type TimeWindow,
  type DateRange,
  getDefaultPreset,
  getTimeWindowRange as sharedGetTimeWindowRange,
  isValidPreset,
  formatDateISO,
  addDays,
  parseISODate,
} from "@/lib/time-presets"
type SqFtChartTab = "calendar" | "area"
type AreaMetric = "sqFtPerOrderHour" | "sqFtEntry"

interface KpiCardProps {
  title: string
  value: string
  tooltip?: string
}

function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `sqft-dash:${key}`
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

function KpiCard({ title, value, tooltip }: KpiCardProps) {
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
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}


function getPeriodLabel(period: string, granularity: SqFtGranularity): string {
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
  return {
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(addDays(startDate, 7)),
  }
}

function getPeriodRange(period: string, granularity: SqFtGranularity): { startDate: string; endDate: string } {
  if (granularity === "yearly") {
    const year = Number(period)
    return {
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-01-01`,
    }
  }
  if (granularity === "monthly") {
    const [year, month] = period.split("-").map(Number)
    const nextMonth = month === 12 ? 1 : month + 1
    const nextYear = month === 12 ? year + 1 : year
    return {
      startDate: `${year}-${String(month).padStart(2, "0")}-01`,
      endDate: `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`,
    }
  }
  if (granularity === "daily") {
    const d = parseISODate(period)
    return {
      startDate: formatDateISO(d),
      endDate: formatDateISO(addDays(d, 1)),
    }
  }
  return getWeekRangeFromWeekStart(period)
}

function parseDashboardDate(value: string): Date | null {
  const raw = value.trim()
  if (!raw) return null

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    return new Date(year, month - 1, day)
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (slashMatch) {
    const month = Number(slashMatch[1])
    const day = Number(slashMatch[2])
    const yearPart = Number(slashMatch[3])
    const year = yearPart < 100 ? 2000 + yearPart : yearPart
    return new Date(year, month - 1, day)
  }

  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatFeedbackDate(value: unknown): string {
  const raw = String(value ?? "")
  const parsed = parseDashboardDate(raw)
  if (!parsed) return raw
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  }).format(parsed)
}

function getFeedbackDateSortKey(value: unknown): string {
  const raw = String(value ?? "")
  const parsed = parseDashboardDate(raw)
  return parsed ? formatDateISO(parsed) : raw
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return formatNumber(value, 0)
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
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
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

function getHeatColor(value: number, max: number): { bg: string; textColor: string } {
  if (value <= 0 || max <= 0) return { bg: "transparent", textColor: "var(--color-text)" }
  const ratio = Math.min(value / max, 1)
  // Interpolate between light indigo (#e0e1fc) and full indigo (#6366f1)
  const r = Math.round(224 + (99 - 224) * ratio)
  const g = Math.round(225 + (102 - 225) * ratio)
  const b = Math.round(252 + (241 - 252) * ratio)
  const textColor = "#000000"
  return { bg: `rgb(${r},${g},${b})`, textColor }
}

export default function SqFtDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const chartScrollRef = useRef<HTMLDivElement | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [timeWindow, setTimeWindow] = usePersistedState<TimeWindow>("timeWindow", "last-12w")
  const [granularity, setGranularity] = usePersistedState<SqFtGranularity>("granularity", "weekly")
  const [chartTab, setChartTab] = usePersistedState<SqFtChartTab>("chartTab", "calendar")
  const [areaMetric, setAreaMetric] = usePersistedState<AreaMetric>("areaMetric", "sqFtPerOrderHour")
  const [lineFilter, setLineFilter] = usePersistedState<string>("lineFilter", "all")
  const [customerFilter, setCustomerFilter] = usePersistedState<string>("customerFilter", "all")
  const [specFilter, setSpecFilter] = usePersistedState<string>("specFilter", "all")
  const [tableSort, setTableSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("tableSort", { key: "feedbackDate", dir: "desc" })
  const [groupByDims, setGroupByDims] = usePersistedState<string[]>("groupByDims", ["feedbackDate", "jobNumber", "customerName", "specNumber", "lineNumber"])
  const [customStart, setCustomStart] = usePersistedState<string>("customStart", "")
  const [customEnd, setCustomEnd] = usePersistedState<string>("customEnd", "")
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)

  // Switch presets when granularity changes
  const prevGranularityRef = useRef(granularity)
  useEffect(() => {
    if (prevGranularityRef.current === granularity) return
    prevGranularityRef.current = granularity
    setTimeWindow(getDefaultPreset(granularity as any))
  }, [granularity, setTimeWindow])

  // Validate persisted timeWindow against current granularity
  useEffect(() => {
    if (!isValidPreset(timeWindow, granularity as any)) {
      setTimeWindow(getDefaultPreset(granularity as any))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [calendarMonth, setCalendarMonth] = usePersistedState<string>(
    "calendarMonth",
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
  )

  const dateLimits = useSqFtDateLimits()
  const limits = dateLimits.data?.data?.[0]
  const customRange: DateRange | null = customStart && customEnd ? { startDate: customStart, endDate: customEnd } : null

  const { startDate, endDate } = useMemo(
    () => sharedGetTimeWindowRange(timeWindow, limits ? { minDate: limits.minDate, maxDate: limits.maxDate } : null, customRange),
    [timeWindow, limits?.minDate, limits?.maxDate, customRange]
  )

  const activeLine = lineFilter !== "all" ? lineFilter : undefined
  const activeCustomer = customerFilter !== "all" ? customerFilter : undefined
  const activeSpec = specFilter !== "all" ? specFilter : undefined

  const [detailStart, detailEnd] = useMemo(() => {
    if (!selectedPeriod) return [startDate, endDate]
    // daily period from calendar tab: "YYYY-MM-DD"
    if (chartTab === "calendar" && selectedPeriod.length === 10) {
      const next = formatDateISO(addDays(parseISODate(selectedPeriod), 1))
      return [selectedPeriod, next]
    }
    const range = getPeriodRange(selectedPeriod, granularity)
    return [range.startDate, range.endDate]
  }, [selectedPeriod, startDate, endDate, granularity, chartTab])

  useEffect(() => {
    setSelectedPeriod(null)
  }, [timeWindow, lineFilter, customerFilter, specFilter, granularity, calendarMonth])

  const summaryQuery = useSqFtSummary(startDate, endDate, granularity, activeLine, activeCustomer, activeSpec)
  const byLineQuery = useSqFtByLine(startDate, endDate, undefined, activeCustomer, activeSpec)
  const detailsQuery = useSqFtDetails(detailStart, detailEnd, activeLine, activeCustomer, activeSpec)
  const filterOptionsQuery = useSqFtFilterOptions(startDate, endDate, activeLine, activeCustomer, activeSpec)

  const calendarRange = useMemo(() => getMonthDateRange(calendarMonth), [calendarMonth])
  const calendarQuery = useSqFtSummary(
    calendarRange.startDate,
    calendarRange.endDate,
    "daily",
    activeLine,
    activeCustomer,
    activeSpec
  )
  const calendarDailyData = calendarQuery.data?.data ?? []

  const calendarMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of calendarDailyData) {
      const sqFtEntry = toNumber(row.sqFtEntry)
      const orderHours = toNumber(row.orderHours)
      const value = areaMetric === "sqFtPerOrderHour"
        ? (orderHours > 0 ? sqFtEntry / orderHours : 0)
        : sqFtEntry
      map.set(row.period, value)
    }
    return map
  }, [calendarDailyData, areaMetric])

  const calendarMax = useMemo(() => {
    let max = 0
    for (const v of calendarMap.values()) {
      if (v > max) max = v
    }
    return max
  }, [calendarMap])

  const groupByDimOptions: [string, string][] = [
    ["feedbackDate", "Date"],
    ["jobNumber", "Job #"],
    ["customerName", "Customer"],
    ["specNumber", "Spec"],
    ["lineNumber", "Line"],
  ]

  const dimLabels: Record<string, string> = {
    feedbackDate: "Feedback Date",
    jobNumber: "Job number",
    customerName: "Customer Name",
    specNumber: "Spec",
    lineNumber: "Line Number",
  }

  const summaryData = summaryQuery.data?.data ?? []
  const byLineData = byLineQuery.data?.data ?? []
  const detailData = detailsQuery.data?.data ?? []
  const filterOptions = filterOptionsQuery.data?.data

  const chartData = useMemo(() => {
    return summaryData.map((row) => {
      const sqFtEntry = toNumber(row.sqFtEntry)
      const orderHours = toNumber(row.orderHours)
      const dayCount = toNumber(row.dayCount)
      return {
        periodKey: row.period,
        label: getPeriodLabel(row.period, granularity),
        sqFtEntry,
        orderHours,
        dayCount,
        sqFtPerDay: dayCount > 0 ? sqFtEntry / dayCount : 0,
        sqFtPerOrderHour: orderHours > 0 ? sqFtEntry / orderHours : 0,
      }
    })
  }, [summaryData, granularity])

  const barData = useMemo(() => {
    return byLineData.map((row) => {
      const sqFtEntry = toNumber(row.sqFtEntry)
      const orderHours = toNumber(row.orderHours)
      return {
        lineNumber: String(row.lineNumber ?? ""),
        sqFtEntry,
        orderHours,
        sqFtPerOrderHour: orderHours > 0 ? sqFtEntry / orderHours : 0,
      }
    }).sort((a, b) => b.sqFtPerOrderHour - a.sqFtPerOrderHour)
  }, [byLineData])

  const detailRows = useMemo(() => {
    return detailData.map((row) => {
      const sqFtEntry = toNumber(row.sqFtEntry)
      const orderHours = toNumber(row.orderHours)
      const feedbackDateRaw = String(row.feedbackDate ?? "")
      return {
        feedbackDate: formatFeedbackDate(feedbackDateRaw),
        feedbackDateSort: getFeedbackDateSortKey(feedbackDateRaw),
        jobNumber: String(row.jobNumber ?? ""),
        customerName: String(row.customerName ?? ""),
        specNumber: String(row.specNumber ?? ""),
        lineNumber: String(row.lineNumber ?? ""),
        sqFtEntry,
        sqFtPerBox: toNumber(row.sqFtPerBox),
        orderHours,
        sqFtPerOrderHour: orderHours > 0 ? sqFtEntry / orderHours : 0,
      }
    })
  }, [detailData])

  const groupedDetailRows = useMemo(() => {
    const allDims = groupByDimOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return detailRows

    const grouped = new Map<string, typeof detailRows[number]>()
    for (const row of detailRows) {
      const keyParts = activeDims.map((d) => {
        if (d === "feedbackDate") return row.feedbackDate
        return (row as unknown as Record<string, unknown>)[d] as string
      })
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          ...row,
          feedbackDate: activeDims.includes("feedbackDate") ? row.feedbackDate : "",
          feedbackDateSort: activeDims.includes("feedbackDate") ? row.feedbackDateSort : "",
          jobNumber: activeDims.includes("jobNumber") ? row.jobNumber : "",
          customerName: activeDims.includes("customerName") ? row.customerName : "",
          specNumber: activeDims.includes("specNumber") ? row.specNumber : "",
          lineNumber: activeDims.includes("lineNumber") ? row.lineNumber : "",
        })
      } else {
        existing.sqFtEntry += row.sqFtEntry
        existing.sqFtPerBox += row.sqFtPerBox
        existing.orderHours += row.orderHours
        existing.sqFtPerOrderHour = existing.orderHours > 0 ? existing.sqFtEntry / existing.orderHours : 0
      }
    }
    return [...grouped.values()]
  }, [detailRows, groupByDims])

  const sortedDetailRows = useMemo(() => {
    const data = [...groupedDetailRows]
    const key = tableSort.key as keyof (typeof data)[number]
    data.sort((a, b) => {
      const aVal = key === "feedbackDate" ? a.feedbackDateSort : a[key]
      const bVal = key === "feedbackDate" ? b.feedbackDateSort : b[key]
      if (typeof aVal === "number" && typeof bVal === "number") {
        return tableSort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      return tableSort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
    return data
  }, [groupedDetailRows, tableSort])

  const kpis = useMemo(() => {
    // When a calendar day is selected, use the daily data for KPIs
    if (chartTab === "calendar" && selectedPeriod && selectedPeriod.length === 10) {
      const dayRow = calendarDailyData.find((d) => d.period === selectedPeriod)
      if (dayRow) {
        const sqFtEntry = toNumber(dayRow.sqFtEntry)
        const orderHours = toNumber(dayRow.orderHours)
        return {
          sqFtEntry,
          orderHours,
          sqFtPerDay: sqFtEntry,
          sqFtPerOrderHour: orderHours > 0 ? sqFtEntry / orderHours : 0,
        }
      }
      return { sqFtEntry: 0, orderHours: 0, sqFtPerDay: 0, sqFtPerOrderHour: 0 }
    }
    const rows = selectedPeriod
      ? chartData.filter((d) => d.periodKey === selectedPeriod)
      : chartData
    const sqFtEntry = rows.reduce((sum, d) => sum + d.sqFtEntry, 0)
    const orderHours = rows.reduce((sum, d) => sum + d.orderHours, 0)
    const dayCount = rows.reduce((sum, d) => sum + d.dayCount, 0)
    return {
      sqFtEntry,
      orderHours,
      sqFtPerDay: dayCount > 0 ? sqFtEntry / dayCount : 0,
      sqFtPerOrderHour: orderHours > 0 ? sqFtEntry / orderHours : 0,
    }
  }, [chartData, selectedPeriod, chartTab, calendarDailyData])

  const detailTotals = useMemo(() => {
    const sqFtEntry = groupedDetailRows.reduce((sum, row) => sum + row.sqFtEntry, 0)
    const orderHours = groupedDetailRows.reduce((sum, row) => sum + row.orderHours, 0)
    const sqFtPerBoxSum = groupedDetailRows.reduce((sum, row) => sum + row.sqFtPerBox, 0)
    const sqFtPerBoxAvg = groupedDetailRows.length > 0 ? sqFtPerBoxSum / groupedDetailRows.length : 0
    return {
      sqFtEntry,
      sqFtPerBoxAvg,
      orderHours,
      sqFtPerOrderHour: orderHours > 0 ? sqFtEntry / orderHours : 0,
    }
  }, [groupedDetailRows])

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
    setTableSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }))
  }, [setTableSort])

  const resetFilters = useCallback(() => {
    setTimeWindow("ytd")
    setGranularity("weekly")
    setLineFilter("all")
    setCustomerFilter("all")
    setSpecFilter("all")
    setTableSort({ key: "feedbackDate", dir: "desc" })
    setSelectedPeriod(null)
  }, [setCustomerFilter, setGranularity, setLineFilter, setSpecFilter, setTableSort, setTimeWindow])

  const maxVisiblePoints = 16
  const needsScroll = (granularity === "weekly" || granularity === "daily") && chartData.length > maxVisiblePoints
  const chartWidth = needsScroll ? chartData.length * 70 : undefined

  useEffect(() => {
    if (needsScroll && chartScrollRef.current) {
      chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth
    }
  }, [needsScroll, chartData.length])

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

  const lineBarHeight = Math.max(200, barData.length * 34)
  const isLoading = summaryQuery.isLoading || byLineQuery.isLoading || detailsQuery.isLoading || filterOptionsQuery.isLoading

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await queryClient.invalidateQueries({ queryKey: ["sqft"] })
      setLastUpdated(new Date())
    } finally {
      setIsRefreshing(false)
    }
  }, [queryClient])

  useEffect(() => {
    if (!lastUpdated && !summaryQuery.isLoading && summaryData.length > 0) {
      setLastUpdated(new Date())
    }
  }, [lastUpdated, summaryQuery.isLoading, summaryData.length])

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 -mx-6 -mt-6 pt-3 space-y-4">
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate("/erp/production")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">Sq Ft Dashboard</span>

        <TimePresetBar
          granularity={granularity as any}
          value={timeWindow}
          onChange={setTimeWindow}
          dateLimits={limits ? { minDate: limits.minDate, maxDate: limits.maxDate } : null}
          customRange={customRange}
          onCustomRangeChange={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
        />

        <div className="ml-auto flex items-center gap-2">
          <SearchableSelect
            value={lineFilter}
            onValueChange={setLineFilter}
            options={filterOptions?.lineNumbers ?? []}
            placeholder="All Lines"
            searchPlaceholder="Search lines..."
            width="w-[150px]"
          />

          <SearchableSelect
            value={customerFilter}
            onValueChange={setCustomerFilter}
            options={filterOptions?.customers ?? []}
            placeholder="All Customers"
            searchPlaceholder="Search customers..."
            width="w-[240px]"
          />

          <SearchableSelect
            value={specFilter}
            onValueChange={setSpecFilter}
            options={filterOptions?.specs ?? []}
            placeholder="All Specs"
            searchPlaceholder="Search specs..."
            width="w-[140px]"
          />

          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetFilters}>
            <RotateCcw className="h-4 w-4" />
          </Button>
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Sq Ft Entry" value={formatNumber(kpis.sqFtEntry, 0)} />
        <KpiCard title="Sq Ft Per Day" value={formatNumber(kpis.sqFtPerDay, 2)} />
        <KpiCard title="Sq Ft per Order Hour" value={formatNumber(kpis.sqFtPerOrderHour, 2)} />
        <KpiCard title="Order Hours" value={formatNumber(kpis.orderHours, 1)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-background-secondary">
          <Tabs value={chartTab} onValueChange={(value) => { setChartTab(value as SqFtChartTab); setSelectedPeriod(null) }}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <CardTitle className="text-base">Sq Ft Trend</CardTitle>
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
                    <div className="flex items-center gap-1">
                      {(["yearly", "monthly", "weekly", "daily"] as SqFtGranularity[]).map((g) => (
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
                  )}
                  <div className="flex items-center gap-1">
                    {([["sqFtPerOrderHour", "Sq Ft / Hr"], ["sqFtEntry", "Sq Ft Entry"]] as [AreaMetric, string][]).map(([key, label]) => (
                      <Button
                        key={key}
                        variant={areaMetric === key ? "default" : "outline"}
                        size="sm"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setAreaMetric(key)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {chartTab === "calendar"
                  ? (areaMetric === "sqFtPerOrderHour" ? "Daily Sq Ft per Order Hour heat map" : "Daily Sq Ft Entry heat map")
                  : areaMetric === "sqFtPerOrderHour"
                  ? "(Sq Ft Entry / Order Hours)"
                  : "Total Sq Ft Entry by period"}
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
                            <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatNumber(v, 0)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatNumber(value, areaMetric === "sqFtPerOrderHour" ? 2 : 0), name]) as any}
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
                            dataKey={areaMetric}
                            name={areaMetric === "sqFtPerOrderHour" ? "Sq Ft per Order Hour" : "Sq Ft Entry"}
                            stroke="#6366f1"
                            fill="url(#gradArea)"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}
                            isAnimationActive={false}
                          >
                            <LabelList dataKey={areaMetric} content={renderAreaLabel((v) => formatNumber(v, 0))} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
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
                              const { bg, textColor } = getHeatColor(value, calendarMax)
                              const isSelected = selectedPeriod === cell.key
                              return (
                                <td key={ci} className="p-0.5">
                                  <div
                                    className={`h-[52px] rounded border border-border/30 cursor-pointer flex flex-col items-center justify-center relative transition-shadow ${
                                      isSelected ? "ring-2 ring-primary ring-offset-1" : ""
                                    }`}
                                    style={{ backgroundColor: value > 0 ? bg : undefined }}
                                    onClick={() => setSelectedPeriod((prev) => prev === cell.key ? null : cell.key)}
                                  >
                                    <span className="absolute top-0.5 right-1.5 text-[10px] leading-none font-bold" style={{ color: value > 0 ? textColor : "var(--color-text-muted)" }}>
                                      {cell.date}
                                    </span>
                                    {value > 0 && (
                                      <span className="text-xs font-bold mt-1" style={{ color: textColor }}>
                                        {formatCompact(value)}
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

        <Card className="bg-background-secondary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sq Ft Per Order Hour</CardTitle>
            <p className="text-sm text-muted-foreground">(Sq Ft Entry / Order Hours)</p>
          </CardHeader>
          <CardContent className="p-0">
            {byLineQuery.isLoading ? (
              <div className="h-[300px] flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : (
              <div className="px-4 pb-4">
                <div
                  className="overflow-y-auto overflow-x-hidden max-h-[250px] cursor-pointer"
                  onClick={(e) => {
                    const wrapper = e.currentTarget.querySelector(".recharts-wrapper") as HTMLElement
                    if (!wrapper || barData.length === 0) return
                    const rect = wrapper.getBoundingClientRect()
                    const y = e.clientY - rect.top
                    const topPad = 5
                    const chartH = rect.height - topPad - 5
                    const rowH = chartH / barData.length
                    const idx = Math.floor((y - topPad) / rowH)
                    if (idx >= 0 && idx < barData.length) {
                      const selected = barData[idx].lineNumber
                      setLineFilter((prev) => prev === selected ? "all" : selected)
                    }
                  }}
                >
                  <ResponsiveContainer width="100%" height={lineBarHeight}>
                    <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="lineNumber" width={50} className="text-xs" tick={{ fontSize: 11 }} />
                      <RechartsTooltip
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        formatter={((value: number, name: string) => [formatNumber(value, 2), name]) as any}
                        contentStyle={{
                          backgroundColor: "var(--color-bg-secondary)",
                          borderColor: "var(--border)",
                          borderRadius: 8,
                        }}
                        labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                        itemStyle={{ color: "var(--color-text)" }}
                        cursor={{ fill: "var(--color-bg-hover)" }}
                      />
                      <Bar dataKey="sqFtPerOrderHour" name="Sq Ft Per Order Hour" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                        {barData.map((d, i) => (
                          <Cell key={i} fill={lineFilter !== "all" && d.lineNumber !== lineFilter ? "#6366f133" : "#6366f1"} />
                        ))}
                        <LabelList
                          dataKey="sqFtPerOrderHour"
                          position="right"
                          fill="var(--color-text)"
                          fontSize={11}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((v: number) => formatNumber(v, 0)) as any}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-background-secondary">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Sq Ft Detail</CardTitle>
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
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative overflow-x-auto max-h-[400px] overflow-y-auto [&>div]:!overflow-visible [&_td]:py-1.5 [&_th]:py-1.5">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]">
                <TableRow>
                  {groupByDimOptions.map(([dim]) =>
                    groupByDims.includes(dim) ? (
                      <TableHead key={dim} className="cursor-pointer hover:text-foreground" onClick={() => handleSort(dim)}>
                        {dimLabels[dim]} {tableSort.key === dim && (tableSort.dir === "asc" ? "↑" : "↓")}
                      </TableHead>
                    ) : null
                  )}
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("sqFtEntry")}>
                    Sq Ft Entry {tableSort.key === "sqFtEntry" && (tableSort.dir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("sqFtPerBox")}>
                    Sq Ft per Box {tableSort.key === "sqFtPerBox" && (tableSort.dir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("sqFtPerOrderHour")}>
                    Sq Ft per Order Hour {tableSort.key === "sqFtPerOrderHour" && (tableSort.dir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("orderHours")}>
                    Order Hours {tableSort.key === "orderHours" && (tableSort.dir === "asc" ? "↑" : "↓")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDetailRows.map((row, idx) => (
                  <TableRow key={`${row.feedbackDate}-${row.jobNumber}-${row.lineNumber}-${idx}`}>
                    {groupByDimOptions.map(([dim]) =>
                      groupByDims.includes(dim) ? (
                        <TableCell key={dim} className={dim === "feedbackDate" ? "font-medium" : dim === "customerName" ? "max-w-[220px] truncate" : ""}>
                          {String((row as Record<string, unknown>)[dim] ?? "")}
                        </TableCell>
                      ) : null
                    )}
                    <TableCell className="text-right">{formatNumber(row.sqFtEntry, 0)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.sqFtPerBox, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.sqFtPerOrderHour, 2)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.orderHours, 1)}</TableCell>
                  </TableRow>
                ))}
                {sortedDetailRows.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={99} className="text-center text-muted-foreground py-8">
                      No Sq Ft detail rows for this selection
                    </TableCell>
                  </TableRow>
                )}
                {sortedDetailRows.length > 0 && (
                  <TableRow className="font-semibold border-t">
                    <TableCell colSpan={groupByDims.length || 1}>Total</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.sqFtEntry, 0)}</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.sqFtPerBoxAvg, 1)}</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.sqFtPerOrderHour, 2)}</TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.orderHours, 1)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
