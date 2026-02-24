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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ArrowLeft, RotateCcw, RefreshCw, Info } from "lucide-react"
import {
  useContributionDateLimits,
  useContributionSummary,
  useContributionByLine,
  useContributionDetails,
  useContributionFilterOptions,
} from "@/api/hooks/useContributionDashboard"
import type { ContributionGranularity } from "@/api/hooks/useContributionDashboard"

type TimeWindow = "all-time" | "last-qtr" | "last-year" | "qtd" | "ytd" | "last-4w" | "last-12w" | "last-26w" | "weeks-ytd"
type ContributionChartTab = "contributionPerOrderHour" | "contribution"

interface KpiCardProps {
  title: string
  value: string
  tooltip?: string
}

function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `contribution-dash:${key}`
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

function formatCurrency(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatPercent(ratio: number, decimals = 1): string {
  return `${formatNumber(ratio * 100, decimals)}%`
}

function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function alignToMonday(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function startOfQuarter(date: Date): Date {
  const month = date.getMonth()
  const quarterStartMonth = Math.floor(month / 3) * 3
  return new Date(date.getFullYear(), quarterStartMonth, 1)
}

function getTimeWindowRange(window: TimeWindow, minDate?: string | null, maxDate?: string | null): { startDate: string; endDate: string } {
  const now = new Date()
  const maxDataDate = maxDate ? parseISODate(maxDate) : null
  const anchorDate = maxDataDate && maxDataDate <= now ? maxDataDate : now
  const dataEndExclusive = maxDate ? formatDateISO(addDays(parseISODate(maxDate), 1)) : formatDateISO(addDays(now, 1))
  const anchorYear = anchorDate.getFullYear()

  if (window === "last-4w" || window === "last-12w" || window === "last-26w" || window === "weeks-ytd") {
    const thisMonday = alignToMonday(now)
    if (window === "last-4w") return { startDate: formatDateISO(addDays(thisMonday, -28)), endDate: dataEndExclusive }
    if (window === "last-12w") return { startDate: formatDateISO(addDays(thisMonday, -84)), endDate: dataEndExclusive }
    if (window === "last-26w") return { startDate: formatDateISO(addDays(thisMonday, -182)), endDate: dataEndExclusive }
    const jan1 = new Date(now.getFullYear(), 0, 1)
    return { startDate: formatDateISO(alignToMonday(jan1)), endDate: dataEndExclusive }
  }

  if (window === "all-time") {
    return {
      startDate: minDate || `${anchorYear - 10}-01-01`,
      endDate: dataEndExclusive,
    }
  }

  if (window === "last-year") {
    return {
      startDate: `${anchorYear - 1}-01-01`,
      endDate: `${anchorYear}-01-01`,
    }
  }

  if (window === "last-qtr") {
    const thisQuarterStart = startOfQuarter(anchorDate)
    const lastQuarterEnd = thisQuarterStart
    const lastQuarterStart = new Date(lastQuarterEnd.getFullYear(), lastQuarterEnd.getMonth() - 3, 1)
    return {
      startDate: formatDateISO(lastQuarterStart),
      endDate: formatDateISO(lastQuarterEnd),
    }
  }

  if (window === "qtd") {
    return {
      startDate: formatDateISO(startOfQuarter(anchorDate)),
      endDate: dataEndExclusive,
    }
  }

  return {
    startDate: `${anchorYear}-01-01`,
    endDate: dataEndExclusive,
  }
}

function getPeriodLabel(period: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const d = parseISODate(period)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split("-")
    return `${month}/${year.slice(-2)}`
  }
  return period
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getWeekRangeFromWeekEnd(weekEnd: string): { startDate: string; endDate: string } {
  const endDate = parseISODate(weekEnd)
  const startDate = addDays(endDate, -6)
  return {
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(addDays(endDate, 1)),
  }
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

export default function ContributionDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const chartScrollRef = useRef<HTMLDivElement | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const [timeWindow, setTimeWindow] = usePersistedState<TimeWindow>("timeWindow", "ytd")
  const [chartTab, setChartTab] = usePersistedState<ContributionChartTab>("chartTab", "contributionPerOrderHour")
  const [lineFilter, setLineFilter] = usePersistedState<string>("lineFilter", "all")
  const [customerFilter, setCustomerFilter] = usePersistedState<string>("customerFilter", "all")
  const [specFilter, setSpecFilter] = usePersistedState<string>("specFilter", "all")
  const [granularity, setGranularity] = usePersistedState<ContributionGranularity>("granularity", "weekly")
  const [tableSort, setTableSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("tableSort", { key: "feedbackDate", dir: "desc" })
  const [groupByDims, setGroupByDims] = usePersistedState<string[]>("groupByDims", ["feedbackDate", "jobNumber", "customerName", "specNumber", "lineNumber"])
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)

  // Switch to weekly presets when granularity is weekly
  const prevGranularityRef = useRef(granularity)
  useEffect(() => {
    if (prevGranularityRef.current === granularity) return
    prevGranularityRef.current = granularity
    if (granularity === "weekly") {
      setTimeWindow("last-12w")
    } else {
      setTimeWindow("ytd")
    }
  }, [granularity, setTimeWindow])

  const dateLimits = useContributionDateLimits()
  const limits = dateLimits.data?.data?.[0]

  const { startDate, endDate } = useMemo(
    () => getTimeWindowRange(timeWindow, limits?.minDate, limits?.maxDate),
    [timeWindow, limits?.minDate, limits?.maxDate]
  )

  const activeLine = lineFilter !== "all" ? lineFilter : undefined
  const activeCustomer = customerFilter !== "all" ? customerFilter : undefined
  const activeSpec = specFilter !== "all" ? specFilter : undefined

  const [detailStart, detailEnd] = useMemo(() => {
    if (!selectedPeriod) return [startDate, endDate]
    if (granularity === "yearly") {
      const year = Number(selectedPeriod)
      return [`${year}-01-01`, `${year + 1}-01-01`]
    }
    if (granularity === "monthly") {
      const [y, m] = selectedPeriod.split("-").map(Number)
      const nextMonth = m === 12 ? 1 : m + 1
      const nextYear = m === 12 ? y + 1 : y
      return [`${y}-${String(m).padStart(2, "0")}-01`, `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`]
    }
    if (granularity === "daily") {
      const d = parseISODate(selectedPeriod)
      return [formatDateISO(d), formatDateISO(addDays(d, 1))]
    }
    // weekly
    const range = getWeekRangeFromWeekEnd(selectedPeriod)
    return [range.startDate, range.endDate]
  }, [selectedPeriod, startDate, endDate, granularity])

  useEffect(() => {
    setSelectedPeriod(null)
  }, [timeWindow, lineFilter, customerFilter, specFilter, granularity])

  const summaryQuery = useContributionSummary(startDate, endDate, granularity, activeLine, activeCustomer, activeSpec)
  const byLineQuery = useContributionByLine(startDate, endDate, undefined, activeCustomer, activeSpec)
  const detailsQuery = useContributionDetails(detailStart, detailEnd, activeLine, activeCustomer, activeSpec)
  const filterOptionsQuery = useContributionFilterOptions(startDate, endDate, activeLine, activeCustomer, activeSpec)

  const summaryData = summaryQuery.data?.data ?? []
  const byLineData = byLineQuery.data?.data ?? []
  const detailData = detailsQuery.data?.data ?? []
  const filterOptions = filterOptionsQuery.data?.data

  const chartData = useMemo(() => {
    return summaryData.map((row) => {
      const calculatedValue = toNumber(row.calculatedValue)
      const contribution = toNumber(row.contribution)
      const orderHours = toNumber(row.orderHours)
      const dayCount = toNumber(row.dayCount)
      const contributionPerOrderHour =
        toNullableNumber(row.contributionPerOrderHour) ?? (orderHours > 0 ? contribution / orderHours : null)
      const contributionPct =
        toNullableNumber(row.contributionPct) ?? (calculatedValue > 0 ? contribution / calculatedValue : null)

      return {
        periodKey: row.period,
        label: getPeriodLabel(row.period),
        calculatedValue,
        contribution,
        orderHours,
        dayCount,
        contributionPerOrderHour,
        contributionPct,
      }
    })
  }, [summaryData])

  const barData = useMemo(() => {
    return byLineData
      .map((row) => {
        const calculatedValue = toNumber(row.calculatedValue)
        const contribution = toNumber(row.contribution)
        const orderHours = toNumber(row.orderHours)
        return {
          lineNumber: String(row.lineNumber ?? ""),
          calculatedValue,
          contribution,
          orderHours,
          contributionPerOrderHour: toNullableNumber(row.contributionPerOrderHour),
          contributionPct:
            toNullableNumber(row.contributionPct) ?? (calculatedValue > 0 ? contribution / calculatedValue : null),
        }
      })
      .sort((a, b) => {
        const aVal = a.contributionPerOrderHour ?? Number.NEGATIVE_INFINITY
        const bVal = b.contributionPerOrderHour ?? Number.NEGATIVE_INFINITY
        return bVal - aVal
      })
  }, [byLineData])

  const groupByDimOptions: [string, string][] = [
    ["feedbackDate", "Date"],
    ["jobNumber", "Job #"],
    ["customerName", "Customer"],
    ["specNumber", "Spec"],
    ["lineNumber", "Line"],
  ]

  const dimLabels: Record<string, string> = {
    feedbackDate: "Feedback Date",
    jobNumber: "Job Number",
    customerName: "Customer Name",
    specNumber: "Spec",
    lineNumber: "Line Number",
  }

  const detailRows = useMemo(() => {
    return detailData.map((row) => {
      const calculatedValue = toNumber(row.calculatedValue)
      const estimatedFullCost = toNumber(row.estimatedFullCost)
      const contribution = toNumber(row.contribution)
      const orderHours = toNumber(row.orderHours)
      const feedbackDateRaw = String(row.feedbackDate ?? "")
      return {
        feedbackDate: formatFeedbackDate(feedbackDateRaw),
        feedbackDateSort: getFeedbackDateSortKey(feedbackDateRaw),
        jobNumber: String(row.jobNumber ?? ""),
        customerName: String(row.customerName ?? ""),
        specNumber: String(row.specNumber ?? ""),
        lineNumber: String(row.lineNumber ?? ""),
        calculatedValue,
        estimatedFullCost,
        contribution,
        orderHours,
        contributionPerOrderHour:
          toNullableNumber(row.contributionPerOrderHour) ?? (orderHours > 0 ? contribution / orderHours : null),
        contributionPct:
          toNullableNumber(row.contributionPct) ?? (calculatedValue > 0 ? contribution / calculatedValue : null),
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
          feedbackDate:     activeDims.includes("feedbackDate")   ? row.feedbackDate     : "",
          feedbackDateSort: activeDims.includes("feedbackDate")   ? row.feedbackDateSort : "",
          jobNumber:        activeDims.includes("jobNumber")      ? row.jobNumber        : "",
          customerName:     activeDims.includes("customerName")   ? row.customerName     : "",
          specNumber:       activeDims.includes("specNumber")     ? row.specNumber       : "",
          lineNumber:       activeDims.includes("lineNumber")     ? row.lineNumber       : "",
        })
      } else {
        existing.calculatedValue  += row.calculatedValue
        existing.estimatedFullCost += row.estimatedFullCost
        existing.contribution     += row.contribution
        existing.orderHours       += row.orderHours
        existing.contributionPerOrderHour = existing.orderHours > 0
          ? existing.contribution / existing.orderHours
          : null
        existing.contributionPct = existing.calculatedValue > 0
          ? existing.contribution / existing.calculatedValue
          : null
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
      if (aVal === null || bVal === null) {
        const aNum = typeof aVal === "number" ? aVal : Number.NEGATIVE_INFINITY
        const bNum = typeof bVal === "number" ? bVal : Number.NEGATIVE_INFINITY
        return tableSort.dir === "asc" ? aNum - bNum : bNum - aNum
      }
      const aStr = String(aVal)
      const bStr = String(bVal)
      return tableSort.dir === "asc" ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr)
    })
    return data
  }, [groupedDetailRows, tableSort])

  const kpis = useMemo(() => {
    const rows = selectedPeriod
      ? chartData.filter((d) => d.periodKey === selectedPeriod)
      : chartData
    const calculatedValue = rows.reduce((sum, d) => sum + d.calculatedValue, 0)
    const contribution = rows.reduce((sum, d) => sum + d.contribution, 0)
    const orderHours = rows.reduce((sum, d) => sum + d.orderHours, 0)
    return {
      calculatedValue,
      contribution,
      orderHours,
      contributionPerOrderHour: orderHours > 0 ? contribution / orderHours : 0,
      contributionPct: calculatedValue > 0 ? contribution / calculatedValue : 0,
    }
  }, [chartData, selectedPeriod])

  const detailTotals = useMemo(() => {
    const calculatedValue = detailRows.reduce((sum, row) => sum + row.calculatedValue, 0)
    const estimatedFullCost = detailRows.reduce((sum, row) => sum + row.estimatedFullCost, 0)
    const contribution = detailRows.reduce((sum, row) => sum + row.contribution, 0)
    const orderHours = detailRows.reduce((sum, row) => sum + row.orderHours, 0)
    return {
      calculatedValue,
      estimatedFullCost,
      contribution,
      orderHours,
      contributionPerOrderHour: orderHours > 0 ? contribution / orderHours : null,
      contributionPct: calculatedValue > 0 ? contribution / calculatedValue : null,
    }
  }, [detailRows])

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
    setGroupByDims(["feedbackDate", "jobNumber", "customerName", "specNumber", "lineNumber"])
    setSelectedPeriod(null)
  }, [setCustomerFilter, setGranularity, setGroupByDims, setLineFilter, setSpecFilter, setTableSort, setTimeWindow])

  const maxVisiblePoints = 16
  const needsScroll = chartData.length > maxVisiblePoints
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
      await queryClient.invalidateQueries({ queryKey: ["contribution"] })
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
        <span className="text-sm font-medium">Contribution Dashboard</span>

        <div className="flex items-center gap-1 ml-2">
          {(granularity === "weekly" ? [
            { key: "last-4w", label: "Last 4W" },
            { key: "last-12w", label: "Last 12W" },
            { key: "last-26w", label: "Last 26W" },
            { key: "weeks-ytd", label: "Weeks YTD" },
          ] : [
            { key: "all-time", label: "All Time" },
            { key: "last-qtr", label: "Last Qtr" },
            { key: "last-year", label: "Last Year" },
            { key: "qtd", label: "QTD" },
            { key: "ytd", label: "YTD" },
          ]).map((option) => (
            <Button
              key={option.key}
              variant={timeWindow === option.key ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => setTimeWindow(option.key as TimeWindow)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Select value={lineFilter} onValueChange={setLineFilter}>
            <SelectTrigger className="w-[150px] h-8 text-xs">
              <SelectValue placeholder="Line Number" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Lines</SelectItem>
              {(filterOptions?.lineNumbers ?? []).map((line) => (
                <SelectItem key={line} value={line}>{line}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger className="w-[240px] h-8 text-xs">
              <SelectValue placeholder="Customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Customers</SelectItem>
              {(filterOptions?.customers ?? []).map((customer) => (
                <SelectItem key={customer} value={customer}>{customer}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={specFilter} onValueChange={setSpecFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue placeholder="Spec" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Specs</SelectItem>
              {(filterOptions?.specs ?? []).map((spec) => (
                <SelectItem key={spec} value={spec}>{spec}</SelectItem>
              ))}
            </SelectContent>
          </Select>

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

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard title="Calculated Value" value={formatCurrency(kpis.calculatedValue, 0)} />
        <KpiCard title="Contribution" value={formatCurrency(kpis.contribution, 0)} />
        <KpiCard
          title="Contribution / Order Hour"
          value={formatCurrency(kpis.contributionPerOrderHour, 2)}
          tooltip="Total contribution divided by total order hours in the current selection."
        />
        <KpiCard title="Order Hours" value={formatNumber(kpis.orderHours, 1)} />
        <KpiCard title="Contribution %" value={formatPercent(kpis.contributionPct, 1)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 bg-background-secondary">
          <Tabs value={chartTab} onValueChange={(value) => setChartTab(value as ContributionChartTab)}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Contribution Trend</CardTitle>
                  <div className="flex items-center gap-1">
                    {(["yearly", "monthly", "weekly", "daily"] as ContributionGranularity[]).map((g) => (
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
                  <TabsTrigger value="contributionPerOrderHour">Contribution / Hr</TabsTrigger>
                  <TabsTrigger value="contribution">Contribution</TabsTrigger>
                </TabsList>
              </div>
              <p className="text-sm text-muted-foreground">
                {chartTab === "contributionPerOrderHour"
                  ? "Contribution divided by order hours by period."
                  : "Total contribution by period."}
              </p>
            </CardHeader>
            <CardContent>
              {summaryQuery.isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : (
                <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                  <div style={needsScroll ? { width: chartWidth } : undefined}>
                    <TabsContent value="contributionPerOrderHour" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart
                          data={chartData}
                          margin={{ top: 20, left: 20, right: 30, bottom: 5 }}
                          onClick={handleChartClick}
                          style={{ cursor: "pointer" }}
                        >
                          <defs>
                            <linearGradient id="gradContributionPerHourTab" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatCurrency(v, 0)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatCurrency(value, 2), name]) as any}
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
                            dataKey="contributionPerOrderHour"
                            name="Contribution / Order Hour"
                            stroke="#6366f1"
                            fill="url(#gradContributionPerHourTab)"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}
                            isAnimationActive={false}
                          >
                            <LabelList dataKey="contributionPerOrderHour" content={renderAreaLabel((v) => formatCurrency(v, 0))} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="contribution" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart
                          data={chartData}
                          margin={{ top: 20, left: 20, right: 30, bottom: 5 }}
                          onClick={handleChartClick}
                          style={{ cursor: "pointer" }}
                        >
                          <defs>
                            <linearGradient id="gradContributionTab" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatCurrency(v, 0)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatCurrency(value, 0), name]) as any}
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
                            dataKey="contribution"
                            name="Contribution"
                            stroke="#6366f1"
                            fill="url(#gradContributionTab)"
                            strokeWidth={2.5}
                            dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}
                            isAnimationActive={false}
                          >
                            <LabelList dataKey="contribution" content={renderAreaLabel((v) => formatCurrency(v, 0))} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                  </div>
                </div>
              )}
            </CardContent>
          </Tabs>
        </Card>

        <Card className="bg-background-secondary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Contribution / Order Hour</CardTitle>
            <p className="text-sm text-muted-foreground">Total contribution divided by total order hours per line.</p>
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
                        formatter={((value: number, name: string) => [formatCurrency(value, 2), name]) as any}
                        contentStyle={{
                          backgroundColor: "var(--color-bg-secondary)",
                          borderColor: "var(--border)",
                          borderRadius: 8,
                        }}
                        labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                        itemStyle={{ color: "var(--color-text)" }}
                        cursor={{ fill: "var(--color-bg-hover)" }}
                      />
                      <Bar dataKey="contributionPerOrderHour" name="Contribution / Order Hour" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                        {barData.map((d, i) => (
                          <Cell key={i} fill={lineFilter !== "all" && d.lineNumber !== lineFilter ? "#6366f133" : "#6366f1"} />
                        ))}
                        <LabelList
                          dataKey="contributionPerOrderHour"
                          position="right"
                          fill="var(--color-text)"
                          fontSize={11}
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((v: number) => formatCurrency(v, 0)) as any}
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
            <CardTitle className="text-base">Contribution Detail</CardTitle>
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
          <div className="relative overflow-x-auto max-h-[400px] overflow-y-auto [&_td]:py-1.5 [&_th]:py-1.5">
            <Table>
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]">
                <TableRow>
                  {groupByDimOptions.map(([dim]) =>
                    groupByDims.includes(dim) ? (
                      <TableHead key={dim} className="cursor-pointer hover:text-foreground" onClick={() => handleSort(dim)}>
                        {dimLabels[dim]} {tableSort.key === dim && (tableSort.dir === "asc" ? "^" : "v")}
                      </TableHead>
                    ) : null
                  )}
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("calculatedValue")}>
                    Value {tableSort.key === "calculatedValue" && (tableSort.dir === "asc" ? "^" : "v")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("estimatedFullCost")}>
                    Est. Full Cost {tableSort.key === "estimatedFullCost" && (tableSort.dir === "asc" ? "^" : "v")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("contribution")}>
                    Contribution {tableSort.key === "contribution" && (tableSort.dir === "asc" ? "^" : "v")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("contributionPerOrderHour")}>
                    Contribution / Hr {tableSort.key === "contributionPerOrderHour" && (tableSort.dir === "asc" ? "^" : "v")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("orderHours")}>
                    Order Hours {tableSort.key === "orderHours" && (tableSort.dir === "asc" ? "^" : "v")}
                  </TableHead>
                  <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleSort("contributionPct")}>
                    Contribution % {tableSort.key === "contributionPct" && (tableSort.dir === "asc" ? "^" : "v")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDetailRows.map((row, idx) => (
                  <TableRow key={`${row.feedbackDate}-${row.jobNumber}-${row.lineNumber}-${idx}`}>
                    {groupByDims.includes("feedbackDate") && <TableCell className="font-medium">{row.feedbackDate}</TableCell>}
                    {groupByDims.includes("jobNumber") && <TableCell>{row.jobNumber}</TableCell>}
                    {groupByDims.includes("customerName") && <TableCell className="max-w-[220px] truncate">{row.customerName}</TableCell>}
                    {groupByDims.includes("specNumber") && <TableCell>{row.specNumber}</TableCell>}
                    {groupByDims.includes("lineNumber") && <TableCell>{row.lineNumber}</TableCell>}
                    <TableCell className="text-right">{formatCurrency(row.calculatedValue, 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.estimatedFullCost, 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(row.contribution, 0)}</TableCell>
                    <TableCell className="text-right">
                      {row.contributionPerOrderHour === null ? "-" : formatCurrency(row.contributionPerOrderHour, 2)}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(row.orderHours, 1)}</TableCell>
                    <TableCell className="text-right">
                      {row.contributionPct === null ? "-" : formatPercent(row.contributionPct, 1)}
                    </TableCell>
                  </TableRow>
                ))}
                {sortedDetailRows.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={groupByDims.length + 6} className="text-center text-muted-foreground py-8">
                      No contribution detail rows for this selection
                    </TableCell>
                  </TableRow>
                )}
                {sortedDetailRows.length > 0 && (
                  <TableRow className="font-semibold border-t">
                    <TableCell colSpan={groupByDims.length}>Total</TableCell>
                    <TableCell className="text-right">{formatCurrency(detailTotals.calculatedValue, 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(detailTotals.estimatedFullCost, 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(detailTotals.contribution, 0)}</TableCell>
                    <TableCell className="text-right">
                      {detailTotals.contributionPerOrderHour === null ? "-" : formatCurrency(detailTotals.contributionPerOrderHour, 2)}
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(detailTotals.orderHours, 1)}</TableCell>
                    <TableCell className="text-right">
                      {detailTotals.contributionPct === null ? "-" : formatPercent(detailTotals.contributionPct, 1)}
                    </TableCell>
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


