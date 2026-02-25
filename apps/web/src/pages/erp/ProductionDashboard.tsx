import { useState, useMemo, useCallback, useEffect, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  BarChart,
  Bar,
  Cell,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
  ReferenceArea,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  RefreshCw,
  Info,
  ChevronDown,
  X,
} from "lucide-react"
import {
  useProductionDateLimits,
  useQualitySummary,
  useQualityByMachine,
  useQualityByShift,
  useQualityDetail,
  useWasteByCategory,
  useSpeedSummary,
  useSpeedByMachine,
  useSpeedByShift,
  useSpeedDetail,
  useSpeedExceptions,
  useUptimeSummary,
  useUptimeByMachine,
  useUptimeByShift,
  useUptimeDetail,
  useDowntimeByReason,
  useOeeDetail,
  useMachines,
  useShifts,
} from "@/api/hooks/useProductionDashboard"
import type { Granularity, QualityDetail, SpeedDetail, UptimeDetail, OeeDetail } from "@/api/hooks/useProductionDashboard"
import { TimePresetBar } from "@/components/ui/time-preset-bar"
import {
  type TimeWindow,
  type DateRange,
  getDefaultPreset,
  getTimeWindowRange as sharedGetTimeWindowRange,
  isValidPreset,
} from "@/lib/time-presets"

type DashboardTab = "quality" | "speed" | "uptime" | "oee"


function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `production-dash:${key}`
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
  if (granularity === "yearly") return period
  if (granularity === "daily" || granularity === "weekly") {
    const [, mm, dd] = period.split("-")
    return `${parseInt(mm, 10)}/${parseInt(dd, 10)}`
  }
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

export default function ProductionDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [timeWindow, setTimeWindow] = usePersistedState<TimeWindow>("timeWindow", "last-6m")
  const [machineFilter, setMachineFilter] = usePersistedState<string>("machineFilter", "all")
  const [shiftFilter, setShiftFilter] = usePersistedState<string>("shiftFilter", "all")
  const [granularity, setGranularity] = usePersistedState<Granularity>("granularity", "monthly")
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null)
  // @ts-expect-error WIP: used when machine/shift table toggle is wired up
  const [tableTab, setTableTab] = usePersistedState<"machine" | "shift">("tableTab", "machine")
  const [tableSort, setTableSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("tableSort", { key: "producedSheets", dir: "desc" })
  const [groupByDims, setGroupByDims] = usePersistedState<string[]>("groupByDims", ["feedbackDate", "jobNum", "customerName", "specNumber", "lineNumber"])
  const [dashboardTab, setDashboardTab] = usePersistedState<DashboardTab>("tab", "quality")
  const [qualityChartTab, setQualityChartTab] = usePersistedState<string>("qualityChartTab", "quality")
  const [speedChartTab, setSpeedChartTab] = usePersistedState<string>("speedChartTab", "speedToOptimum")
  const [uptimeChartTab, setUptimeChartTab] = usePersistedState<string>("uptimeChartTab", "uptimePct")
  const [oeeChartTab, setOeeChartTab] = usePersistedState<string>("oeeChartTab", "oeePct")
  const [customStart, setCustomStart] = usePersistedState<string>("customStart", "")
  const [customEnd, setCustomEnd] = usePersistedState<string>("customEnd", "")

  // Speed detail slicers
  const [speedCustomerFilter, setSpeedCustomerFilter] = useState<string>("all")
  const [speedSpecFilter, setSpeedSpecFilter] = useState<string>("all")
  const [speedJobFilter, setSpeedJobFilter] = useState<string>("all")

  // Clear selected period and speed detail slicers when major filters change
  useEffect(() => {
    setSelectedPeriod(null)
    setSpeedCustomerFilter("all")
    setSpeedSpecFilter("all")
    setSpeedJobFilter("all")
  }, [timeWindow, granularity, machineFilter, shiftFilter, dashboardTab])

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

  const prodDateLimits = useProductionDateLimits()
  const prodLimits = prodDateLimits.data?.data?.[0]
  const customRange: DateRange | null = customStart && customEnd ? { startDate: customStart, endDate: customEnd } : null

  const { startDate, endDate } = useMemo(
    () => sharedGetTimeWindowRange(timeWindow, prodLimits ? { minDate: prodLimits.minDate, maxDate: prodLimits.maxDate } : null, customRange),
    [timeWindow, prodLimits?.minDate, prodLimits?.maxDate, customRange]
  )

  const summaryStart = startDate
  const summaryEnd = endDate

  const activeMachine = machineFilter !== "all" ? machineFilter : undefined
  const activeShift = shiftFilter !== "all" ? shiftFilter : undefined

  // Narrow date range when a period is selected (for detail queries)
  const [detailStart, detailEnd] = useMemo(() => {
    if (!selectedPeriod) return [startDate, endDate]
    if (granularity === "yearly") {
      return [`${selectedPeriod}-01-01`, `${parseInt(selectedPeriod) + 1}-01-01`]
    }
    if (granularity === "daily") {
      const d = new Date(selectedPeriod)
      const end = new Date(d)
      end.setDate(end.getDate() + 1)
      return [d.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
    }
    if (granularity === "weekly") {
      const d = new Date(selectedPeriod)
      const end = new Date(d)
      end.setDate(end.getDate() + 7)
      return [d.toISOString().slice(0, 10), end.toISOString().slice(0, 10)]
    }
    // monthly: "2026-01" -> "2026-01-01" to "2026-02-01"
    const [y, m] = selectedPeriod.split("-").map(Number)
    const nextMonth = m === 12 ? 1 : m + 1
    const nextYear = m === 12 ? y + 1 : y
    return [`${y}-${String(m).padStart(2, "0")}-01`, `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`]
  }, [selectedPeriod, startDate, endDate, granularity])

  const isQuality = dashboardTab === "quality"
  const isSpeed = dashboardTab === "speed"
  const isUptime = dashboardTab === "uptime"
  const isOee = dashboardTab === "oee"

  const groupByDimOptions: [string, string][] = [
    ["feedbackDate", "Date"],
    ["jobNum", "Job"],
    ["customerName", "Customer"],
    ["specNumber", "Spec"],
    ["lineNumber", "Line"],
  ]

  const summaryQuery = useQualitySummary(summaryStart, summaryEnd, granularity, activeMachine, activeShift)
  const byMachineQuery = useQualityByMachine(detailStart, detailEnd, activeShift)
  const byShiftQuery = useQualityByShift(detailStart, detailEnd, activeMachine)
  const qualityDetailQuery = useQualityDetail(detailStart, detailEnd, activeMachine, activeShift, isQuality)
  const wasteByCategoryQuery = useWasteByCategory(detailStart, detailEnd, activeMachine, activeShift)
  const speedSummaryQuery = useSpeedSummary(summaryStart, summaryEnd, granularity, activeMachine, activeShift, isSpeed || isOee)
  const speedByMachineQuery = useSpeedByMachine(detailStart, detailEnd, activeShift, isSpeed || isOee)
  const speedByShiftQuery = useSpeedByShift(detailStart, detailEnd, activeMachine, isSpeed || isOee)
  const speedDetailQuery = useSpeedDetail(detailStart, detailEnd, activeMachine, activeShift, isSpeed)
  const speedExceptionsQuery = useSpeedExceptions(detailStart, detailEnd, activeMachine, activeShift, isSpeed || isOee)
  const uptimeSummaryQuery = useUptimeSummary(summaryStart, summaryEnd, granularity, activeMachine, activeShift, isUptime || isOee)
  const uptimeByMachineQuery = useUptimeByMachine(detailStart, detailEnd, activeShift, isUptime || isOee)
  const uptimeByShiftQuery = useUptimeByShift(detailStart, detailEnd, activeMachine, isUptime || isOee)
  const uptimeDetailQuery = useUptimeDetail(detailStart, detailEnd, activeMachine, activeShift, isUptime)
  const downtimeByReasonQuery = useDowntimeByReason(detailStart, detailEnd, activeMachine, activeShift, isUptime)
  const oeeDetailQuery = useOeeDetail(detailStart, detailEnd, activeMachine, activeShift, isOee)
  const machinesQuery = useMachines()
  const shiftsQuery = useShifts()

  const summaryData = summaryQuery.data?.data ?? []
  const machineData = byMachineQuery.data?.data ?? []
  // @ts-expect-error WIP: used when shift breakdowns are wired up
  const shiftData = byShiftQuery.data?.data ?? []
  const qualityDetailData = qualityDetailQuery.data?.data ?? []
  const wasteByCategoryData = wasteByCategoryQuery.data?.data ?? []
  const speedSummaryData = speedSummaryQuery.data?.data ?? []
  const speedMachineData = speedByMachineQuery.data?.data ?? []
  // @ts-expect-error WIP: used when shift breakdowns are wired up
  const speedShiftData = speedByShiftQuery.data?.data ?? []
  const speedDetailData = speedDetailQuery.data?.data ?? []
  const speedExceptionsData = speedExceptionsQuery.data?.data ?? []
  const uptimeSummaryData = uptimeSummaryQuery.data?.data ?? []
  const uptimeMachineData = uptimeByMachineQuery.data?.data ?? []
  // @ts-expect-error WIP: used when shift breakdowns are wired up
  const uptimeShiftData = uptimeByShiftQuery.data?.data ?? []
  const uptimeDetailData = uptimeDetailQuery.data?.data ?? []
  const oeeDetailData = oeeDetailQuery.data?.data ?? []
  const machines = machinesQuery.data?.data ?? []
  const shifts = shiftsQuery.data?.data ?? []

  // Chart data
  const chartData = useMemo(() => {
    return summaryData.map((m) => {
      const qualityPct = (m.producedSheets + m.wasteSheets) > 0
        ? (m.producedSheets / (m.producedSheets + m.wasteSheets)) * 100
        : 0
      const wastePct = (m.producedSheets + m.wasteSheets) > 0
        ? (m.wasteSheets / (m.producedSheets + m.wasteSheets)) * 100
        : 0
      return {
        label: getPeriodLabel(m.period, granularity),
        periodKey: m.period,
        qualityPct,
        wastePct,
        producedSheets: m.producedSheets,
        wasteSheets: m.wasteSheets,
        producedQty: m.producedQty,
        fedQty: m.fedQty,
      }
    })
  }, [summaryData, granularity])

  // KPI calculations
  const kpis = useMemo(() => {
    const periods = selectedPeriod
      ? summaryData.filter((m) => m.period === selectedPeriod)
      : summaryData
    const producedSheets = periods.reduce((sum, m) => sum + m.producedSheets, 0)
    const wasteSheets = periods.reduce((sum, m) => sum + m.wasteSheets, 0)
    const producedQty = periods.reduce((sum, m) => sum + m.producedQty, 0)
    const fedQty = periods.reduce((sum, m) => sum + m.fedQty, 0)
    const totalSheets = producedSheets + wasteSheets
    const qualityPct = totalSheets > 0 ? (producedSheets / totalSheets) * 100 : 0
    const wastePct = totalSheets > 0 ? (wasteSheets / totalSheets) * 100 : 0

    return {
      qualityPct,
      producedSheets,
      wasteSheets,
      wastePct,
      producedQty,
      fedQty,
    }
  }, [summaryData, selectedPeriod])

  // Waste by category bar chart data
  const wasteCategoryBarData = useMemo(() => wasteByCategoryData.map((w) => ({
    name: w.wasteCode || "Unknown",
    wasteSheets: w.wasteSheets,
  })), [wasteByCategoryData])

  const wasteCategoryBarHeight = Math.max(200, wasteCategoryBarData.length * 34)

  // Speed chart data
  const speedChartData = useMemo(() => {
    return speedSummaryData.map((m) => {
      const sheetsPerHour = m.uptimeHours > 0 ? m.totalFedIn / m.uptimeHours : 0
      const speedToOptimum = m.avgOptimumSpeed > 0 ? (sheetsPerHour / m.avgOptimumSpeed) * 100 : 0
      return {
        label: getPeriodLabel(m.period, granularity),
        periodKey: m.period,
        speedToOptimum,
        sheetsPerHour,
        uptimeHours: m.uptimeHours,
        totalFedIn: m.totalFedIn,
        avgOptimumSpeed: m.avgOptimumSpeed,
      }
    })
  }, [speedSummaryData, granularity])

  // Speed KPIs
  const speedKpis = useMemo(() => {
    const periods = selectedPeriod
      ? speedSummaryData.filter((m) => m.period === selectedPeriod)
      : speedSummaryData
    const totalFedIn = periods.reduce((sum, m) => sum + m.totalFedIn, 0)
    const uptimeHours = periods.reduce((sum, m) => sum + m.uptimeHours, 0)
    const avgOptimumSpeed = periods.length > 0
      ? periods.reduce((sum, m) => sum + m.avgOptimumSpeed, 0) / periods.length
      : 0
    const sheetsPerHour = uptimeHours > 0 ? totalFedIn / uptimeHours : 0
    const speedToOptimum = avgOptimumSpeed > 0 ? (sheetsPerHour / avgOptimumSpeed) * 100 : 0
    return { speedToOptimum, sheetsPerHour, avgOptimumSpeed, totalFedIn, uptimeHours }
  }, [speedSummaryData, selectedPeriod])

  // Speed by machine bar data
  const speedMachineBarData = useMemo(() => {
    return speedMachineData.map((m) => {
      const sheetsPerHour = m.uptimeHours > 0 ? m.totalFedIn / m.uptimeHours : 0
      const speedToOptimum = m.optimumSpeed > 0 ? (sheetsPerHour / m.optimumSpeed) * 100 : 0
      return {
        name: m.machineName,
        machineNumber: m.machineNumber,
        speedToOptimum,
        sheetsPerHour,
      }
    }).sort((a, b) => b.speedToOptimum - a.speedToOptimum)
  }, [speedMachineData])

  const speedMachineBarHeight = Math.max(200, speedMachineBarData.length * 34)

  // Uptime chart data
  const uptimeChartData = useMemo(() => {
    return uptimeSummaryData.map((m) => {
      const runHours = m.orderHours - m.setupHours
      const uptimeHours = runHours - m.downtimeOpen - m.downtimeClosed
      const uptimePct = runHours > 0 ? (uptimeHours / runHours) * 100 : 0
      return {
        label: getPeriodLabel(m.period, granularity),
        periodKey: m.period,
        uptimePct,
        uptimeHours,
        runHours,
        orderHours: m.orderHours,
        setupHours: m.setupHours,
        downtimeOpen: m.downtimeOpen,
        downtimeClosed: m.downtimeClosed,
      }
    })
  }, [uptimeSummaryData, granularity])

  // Uptime KPIs
  const uptimeKpis = useMemo(() => {
    const periods = selectedPeriod
      ? uptimeSummaryData.filter((m) => m.period === selectedPeriod)
      : uptimeSummaryData
    const orderHours = periods.reduce((sum, m) => sum + m.orderHours, 0)
    const setupHours = periods.reduce((sum, m) => sum + m.setupHours, 0)
    const downtimeOpen = periods.reduce((sum, m) => sum + m.downtimeOpen, 0)
    const downtimeClosed = periods.reduce((sum, m) => sum + m.downtimeClosed, 0)
    const runHours = orderHours - setupHours
    const uptimeHours = runHours - downtimeOpen - downtimeClosed
    const uptimePct = runHours > 0 ? (uptimeHours / runHours) * 100 : 0
    return { uptimePct, uptimeHours, runHours, orderHours, setupHours, downtimeOpen, downtimeClosed }
  }, [uptimeSummaryData, selectedPeriod])

  // Downtime by reason bar data
  const downtimeReasonData = downtimeByReasonQuery.data?.data ?? []
  const downtimeReasonBarHeight = Math.max(200, downtimeReasonData.length * 34)

  // OEE chart data — composed from existing quality + speed + uptime summaries
  const oeeChartData = useMemo(() => {
    const speedMap = new Map(speedSummaryData.map(s => [s.period, s]))
    const uptimeMap = new Map(uptimeSummaryData.map(u => [u.period, u]))

    return summaryData.map((q) => {
      const s = speedMap.get(q.period)
      const u = uptimeMap.get(q.period)

      const totalSheets = q.producedSheets + q.wasteSheets
      const qualityPct = totalSheets > 0 ? (q.producedSheets / totalSheets) * 100 : 0

      let speedPct = 0
      if (s) {
        const sph = s.uptimeHours > 0 ? s.totalFedIn / s.uptimeHours : 0
        speedPct = s.avgOptimumSpeed > 0 ? (sph / s.avgOptimumSpeed) * 100 : 0
      }

      let uptimePct = 0
      if (u) {
        const runH = u.orderHours - u.setupHours
        const upH = runH - u.downtimeOpen - u.downtimeClosed
        uptimePct = runH > 0 ? (upH / runH) * 100 : 0
      }

      const oeePct = (qualityPct / 100) * (speedPct / 100) * (uptimePct / 100) * 100

      return {
        label: getPeriodLabel(q.period, granularity),
        periodKey: q.period,
        oeePct,
        qualityPct,
        speedPct,
        uptimePct,
      }
    })
  }, [summaryData, speedSummaryData, uptimeSummaryData, granularity])

  // OEE KPIs — derived from existing quality/speed/uptime KPIs
  const oeeKpis = useMemo(() => {
    const oeePct = (kpis.qualityPct / 100) * (speedKpis.speedToOptimum / 100) * (uptimeKpis.uptimePct / 100) * 100
    return {
      oeePct,
      qualityPct: kpis.qualityPct,
      speedPct: speedKpis.speedToOptimum,
      uptimePct: uptimeKpis.uptimePct,
      producedSheets: kpis.producedSheets,
      runHours: uptimeKpis.runHours,
    }
  }, [kpis, speedKpis, uptimeKpis])

  // OEE by machine bar data — composed from quality + speed + uptime by-machine
  const oeeMachineBarData = useMemo(() => {
    const speedMap = new Map(speedMachineData.map(s => [s.machineNumber, s]))
    const uptimeMap = new Map(uptimeMachineData.map(u => [u.machineNumber, u]))

    return machineData.map((q) => {
      const s = speedMap.get(q.machineNumber)
      const u = uptimeMap.get(q.machineNumber)

      const totalSheets = q.producedSheets + q.wasteSheets
      const qualityPct = totalSheets > 0 ? (q.producedSheets / totalSheets) * 100 : 0

      let speedPct = 0
      if (s) {
        const sph = s.uptimeHours > 0 ? s.totalFedIn / s.uptimeHours : 0
        speedPct = s.optimumSpeed > 0 ? (sph / s.optimumSpeed) * 100 : 0
      }

      let uptimePct = 0
      if (u) {
        const runH = u.orderHours - u.setupHours
        const upH = runH - u.downtimeOpen - u.downtimeClosed
        uptimePct = runH > 0 ? (upH / runH) * 100 : 0
      }

      const oeePct = (qualityPct / 100) * (speedPct / 100) * (uptimePct / 100) * 100

      return {
        name: q.machineName,
        machineNumber: q.machineNumber,
        oeePct,
      }
    }).sort((a, b) => b.oeePct - a.oeePct)
  }, [machineData, speedMachineData, uptimeMachineData])

  const oeeMachineBarHeight = Math.max(200, oeeMachineBarData.length * 34)

  // Area chart click handler
  const activeChartData = isOee ? oeeChartData : isSpeed ? speedChartData : isUptime ? uptimeChartData : chartData

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = useCallback((data: any) => {
    let periodKey = data?.activePayload?.[0]?.payload?.periodKey as string | undefined
    if (!periodKey && data?.activeLabel) {
      const match = activeChartData.find((d) => d.label === data.activeLabel)
      if (match) periodKey = match.periodKey
    }
    if (!periodKey) return
    setSelectedPeriod((prev) => (prev === periodKey ? null : periodKey))
  }, [activeChartData])

  // Grey-out regions for non-selected periods
  const dimRegions = useMemo(() => {
    if (!selectedPeriod || activeChartData.length === 0) return null
    const idx = activeChartData.findIndex((d) => d.periodKey === selectedPeriod)
    if (idx < 0) return null
    const labels = activeChartData.map((d) => d.label)
    const left = idx > 0 ? { x1: labels[0], x2: labels[idx - 1] } : null
    const right = idx < labels.length - 1 ? { x1: labels[idx + 1], x2: labels[labels.length - 1] } : null
    return { left, right }
  }, [selectedPeriod, activeChartData])

  // Smart area chart label
  const renderAreaLabel = useCallback((formatter: (v: number) => string) => {
    const total = activeChartData.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (props: any) => {
      const { x, y, value, index } = props
      const anchor = index === 0 ? "start" : index === total - 1 ? "end" : "middle"
      return (
        <text x={x} y={y - 10} fill="var(--color-text)" fontSize={11} textAnchor={anchor}>
          {formatter(value)}
        </text>
      )
    }
  }, [activeChartData.length])

  // Scrollable chart for weekly view
  const chartScrollRef = useRef<HTMLDivElement>(null)
  const maxVisiblePoints = 16
  const needsScroll = (granularity === "weekly" || granularity === "daily") && activeChartData.length > maxVisiblePoints
  const chartWidth = needsScroll ? activeChartData.length * 70 : undefined

  useEffect(() => {
    if (needsScroll && chartScrollRef.current) {
      chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth
    }
  }, [needsScroll, activeChartData.length])

  // Table sorting
  const handleTableSort = (key: string) => {
    setTableSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortTableData = <T extends Record<string, any>>(data: T[]) => {
    const key = tableSort.key
    return [...data].sort((a, b) => {
      const aVal = a[key] ?? 0
      const bVal = b[key] ?? 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        return tableSort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      return tableSort.dir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal))
    })
  }

  // Quality detail table
  const groupedQualityDetailData = useMemo(() => {
    const allDims = groupByDimOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return qualityDetailData as QualityDetail[]

    const grouped = new Map<string, QualityDetail>()
    for (const row of qualityDetailData) {
      const keyParts = activeDims.map((d) => String((row as unknown as Record<string, unknown>)[d] ?? ""))
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          ...row,
          feedbackDate: activeDims.includes("feedbackDate") ? row.feedbackDate : "",
          weekStartDate: activeDims.includes("feedbackDate") ? row.weekStartDate : "",
          jobNum: activeDims.includes("jobNum") ? row.jobNum : "",
          customerName: activeDims.includes("customerName") ? (row as unknown as Record<string, string>).customerName ?? "" : "",
          specNumber: activeDims.includes("specNumber") ? (row as unknown as Record<string, string>).specNumber ?? "" : "",
          lineNumber: activeDims.includes("lineNumber") ? (row as unknown as Record<string, number>).lineNumber ?? 0 : 0,
        })
      } else {
        existing.reportedWaste += row.reportedWaste
        existing.prerunWaste += row.prerunWaste
        existing.producedSheets += row.producedSheets
        existing.qualityPct = (existing.producedSheets + existing.reportedWaste) > 0
          ? existing.producedSheets / (existing.producedSheets + existing.reportedWaste) * 100
          : 0
      }
    }
    return [...grouped.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualityDetailData, groupByDims])

  const sortedQualityDetailData = useMemo(() => {
    return sortTableData(groupedQualityDetailData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedQualityDetailData, tableSort])

  const qualityDetailTotals = useMemo(() => {
    const rows = groupedQualityDetailData
    if (rows.length === 0) return null
    const totalReportedWaste = rows.reduce((s: number, r) => s + r.reportedWaste, 0)
    const totalPrerunWaste = rows.reduce((s: number, r) => s + r.prerunWaste, 0)
    const totalProducedSheets = rows.reduce((s: number, r) => s + r.producedSheets, 0)
    const qualityPct = (totalProducedSheets + totalReportedWaste) > 0
      ? totalProducedSheets / (totalProducedSheets + totalReportedWaste) * 100
      : 0
    return { reportedWaste: totalReportedWaste, prerunWaste: totalPrerunWaste, producedSheets: totalProducedSheets, qualityPct }
  }, [groupedQualityDetailData])

  // Speed detail slicer options (derived from unfiltered data)
  const speedDetailSlicerOptions = useMemo(() => {
    const customers = new Set<string>()
    const specs = new Set<string>()
    const jobs = new Set<string>()
    for (const r of speedDetailData) {
      if (r.customerName) customers.add(r.customerName)
      if (r.specNumber) specs.add(r.specNumber)
      if (r.jobNum) jobs.add(r.jobNum)
    }
    return {
      customers: Array.from(customers).sort(),
      specs: Array.from(specs).sort(),
      jobs: Array.from(jobs).sort(),
    }
  }, [speedDetailData])

  // Speed detail filtered data
  const filteredSpeedDetailData = useMemo(() => {
    return speedDetailData.filter((r) => {
      if (speedCustomerFilter !== "all" && r.customerName !== speedCustomerFilter) return false
      if (speedSpecFilter !== "all" && r.specNumber !== speedSpecFilter) return false
      if (speedJobFilter !== "all" && r.jobNum !== speedJobFilter) return false
      return true
    })
  }, [speedDetailData, speedCustomerFilter, speedSpecFilter, speedJobFilter])

  // Speed detail table
  const groupedSpeedDetailData = useMemo(() => {
    const allDims = groupByDimOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return filteredSpeedDetailData as SpeedDetail[]

    const grouped = new Map<string, SpeedDetail>()
    for (const row of filteredSpeedDetailData) {
      const keyParts = activeDims.map((d) => String((row as unknown as Record<string, unknown>)[d] ?? ""))
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          ...row,
          feedbackDate: activeDims.includes("feedbackDate") ? row.feedbackDate : "",
          weekStartDate: activeDims.includes("feedbackDate") ? row.weekStartDate : "",
          jobNum: activeDims.includes("jobNum") ? row.jobNum : "",
          customerName: activeDims.includes("customerName") ? row.customerName : "",
          specNumber: activeDims.includes("specNumber") ? row.specNumber : "",
          lineNumber: activeDims.includes("lineNumber") ? row.lineNumber : 0,
        })
      } else {
        const totalFedIn = existing.speedSheetsPerHour * existing.uptimeHours + row.speedSheetsPerHour * row.uptimeHours
        existing.uptimeHours += row.uptimeHours
        existing.orderHours += row.orderHours
        existing.speedSheetsPerHour = existing.uptimeHours > 0 ? totalFedIn / existing.uptimeHours : 0
        existing.speedSheetsPerOrderHour = existing.orderHours > 0 ? totalFedIn / existing.orderHours : 0
        existing.speedToOptimumPct = existing.optimumRunSpeed > 0 ? (existing.speedSheetsPerHour / existing.optimumRunSpeed) * 100 : 0
        existing.speedToOptimumOrderPct = existing.optimumRunSpeed > 0 ? (existing.speedSheetsPerOrderHour / existing.optimumRunSpeed) * 100 : 0
      }
    }
    return [...grouped.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSpeedDetailData, groupByDims])

  const sortedSpeedDetailData = useMemo(() => {
    return sortTableData(groupedSpeedDetailData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedSpeedDetailData, tableSort])

  const speedDetailTotals = useMemo(() => {
    const rows = groupedSpeedDetailData as SpeedDetail[]
    if (rows.length === 0) return null
    const totalFedIn = rows.reduce((s: number, r) => s + (r.speedSheetsPerHour * r.uptimeHours), 0)
    const totalUptimeHours = rows.reduce((s: number, r) => s + r.uptimeHours, 0)
    const totalOrderHours = rows.reduce((s: number, r) => s + r.orderHours, 0)
    const avgOptimum = rows.reduce((s: number, r) => s + r.optimumRunSpeed, 0) / rows.length
    const sheetsPerHour = totalUptimeHours > 0 ? totalFedIn / totalUptimeHours : 0
    const sheetsPerOrderHour = totalOrderHours > 0 ? totalFedIn / totalOrderHours : 0
    const totalRunHours = rows.reduce((s: number, r) => r.uptimePct > 0 ? s + r.uptimeHours / (r.uptimePct / 100) : s, 0)
    return {
      speedToOptimumPct: avgOptimum > 0 ? (sheetsPerHour / avgOptimum) * 100 : 0,
      speedToOptimumOrderPct: avgOptimum > 0 ? (sheetsPerOrderHour / avgOptimum) * 100 : 0,
      speedSheetsPerHour: sheetsPerHour,
      speedSheetsPerOrderHour: sheetsPerOrderHour,
      uptimeHours: totalUptimeHours,
      actualSpeed: rows.reduce((s: number, r) => s + (r.actualSpeed ?? 0), 0) / rows.length,
      optimumRunSpeed: avgOptimum,
      orderHours: totalOrderHours,
      uptimePct: totalRunHours > 0 ? totalUptimeHours / totalRunHours * 100 : 0,
    }
  }, [groupedSpeedDetailData])

  // Speed exceptions table
  const [exceptionsOpen, setExceptionsOpen] = useState(false)
  const [exceptionsSort, setExceptionsSort] = usePersistedState<{ key: string; dir: "asc" | "desc" }>("exceptionsSort", { key: "feedDate", dir: "desc" })

  const handleExceptionsSort = (key: string) => {
    setExceptionsSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc",
    }))
  }

  const sortedExceptionsData = useMemo(() => {
    const key = exceptionsSort.key
    return [...speedExceptionsData].map((row) => ({
      ...row,
      pctOver: row.optimumSpeed > 0 ? ((row.actualSpeed - row.optimumSpeed) / row.optimumSpeed) * 100 : 0,
    })).sort((a, b) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aVal = (a as any)[key] ?? 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bVal = (b as any)[key] ?? 0
      if (typeof aVal === "number" && typeof bVal === "number") {
        return exceptionsSort.dir === "asc" ? aVal - bVal : bVal - aVal
      }
      return exceptionsSort.dir === "asc" ? String(aVal).localeCompare(String(bVal)) : String(bVal).localeCompare(String(aVal))
    })
  }, [speedExceptionsData, exceptionsSort])

  // Uptime detail table
  const groupedUptimeDetailData = useMemo(() => {
    const allDims = groupByDimOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return uptimeDetailData as UptimeDetail[]

    const grouped = new Map<string, UptimeDetail>()
    for (const row of uptimeDetailData) {
      const keyParts = activeDims.map((d) => String((row as unknown as Record<string, unknown>)[d] ?? ""))
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          ...row,
          feedbackDate: activeDims.includes("feedbackDate") ? row.feedbackDate : "",
          weekStartDate: activeDims.includes("feedbackDate") ? row.weekStartDate : "",
          jobNum: activeDims.includes("jobNum") ? row.jobNum : "",
          customerName: activeDims.includes("customerName") ? (row as unknown as Record<string, string>).customerName ?? "" : "",
          specNumber: activeDims.includes("specNumber") ? (row as unknown as Record<string, string>).specNumber ?? "" : "",
          lineNumber: activeDims.includes("lineNumber") ? (row as unknown as Record<string, number>).lineNumber ?? 0 : 0,
        })
      } else {
        existing.setupHours += row.setupHours
        existing.runHours += row.runHours
        existing.downtimeHours += row.downtimeHours
        existing.orderHours += row.orderHours
        existing.uptimeHours += row.uptimeHours
        existing.setupPct = existing.orderHours > 0 ? existing.setupHours / existing.orderHours * 100 : 0
        existing.uptimePct = existing.runHours > 0 ? existing.uptimeHours / existing.runHours * 100 : 0
        existing.downtimePct = existing.orderHours > 0 ? existing.downtimeHours / existing.orderHours * 100 : 0
      }
    }
    return [...grouped.values()]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uptimeDetailData, groupByDims])

  const sortedUptimeDetailData = useMemo(() => {
    return sortTableData(groupedUptimeDetailData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedUptimeDetailData, tableSort])

  const uptimeDetailTotals = useMemo(() => {
    const rows = groupedUptimeDetailData
    if (rows.length === 0) return null
    const totalSetupHours = rows.reduce((s: number, r) => s + r.setupHours, 0)
    const totalRunHours = rows.reduce((s: number, r) => s + r.runHours, 0)
    const totalDowntimeHours = rows.reduce((s: number, r) => s + r.downtimeHours, 0)
    const totalOrderHours = rows.reduce((s: number, r) => s + r.orderHours, 0)
    const totalUptimeHours = rows.reduce((s: number, r) => s + r.uptimeHours, 0)
    return {
      setupHours: totalSetupHours,
      runHours: totalRunHours,
      downtimeHours: totalDowntimeHours,
      orderHours: totalOrderHours,
      uptimeHours: totalUptimeHours,
      setupPct: totalOrderHours > 0 ? totalSetupHours / totalOrderHours * 100 : 0,
      uptimePct: totalRunHours > 0 ? totalUptimeHours / totalRunHours * 100 : 0,
      downtimePct: totalOrderHours > 0 ? totalDowntimeHours / totalOrderHours * 100 : 0,
    }
  }, [groupedUptimeDetailData])

  // OEE detail table
  const groupedOeeDetailData = useMemo(() => {
    const allDims = groupByDimOptions.map(([d]) => d)
    const activeDims = allDims.filter((d) => groupByDims.includes(d))
    if (activeDims.length === allDims.length) return oeeDetailData as OeeDetail[]

    const grouped = new Map<string, { row: OeeDetail; count: number; sumUptime: number; sumSpeed: number; sumQuality: number }>()
    for (const row of oeeDetailData) {
      const keyParts = activeDims.map((d) => String((row as unknown as Record<string, unknown>)[d] ?? ""))
      const key = keyParts.join("|")
      const existing = grouped.get(key)
      if (!existing) {
        grouped.set(key, {
          row: {
            ...row,
            feedbackDate: activeDims.includes("feedbackDate") ? row.feedbackDate : "",
            jobNum: activeDims.includes("jobNum") ? row.jobNum : "",
            customerName: activeDims.includes("customerName") ? row.customerName : "",
            specNumber: activeDims.includes("specNumber") ? row.specNumber : "",
            lineNumber: activeDims.includes("lineNumber") ? row.lineNumber : 0,
          },
          count: 1,
          sumUptime: row.uptimePct,
          sumSpeed: row.speedToOptimumPct,
          sumQuality: row.qualityPct,
        })
      } else {
        existing.row.setupCount += row.setupCount
        existing.row.orderHours += row.orderHours
        existing.count += 1
        existing.sumUptime += row.uptimePct
        existing.sumSpeed += row.speedToOptimumPct
        existing.sumQuality += row.qualityPct
      }
    }
    return [...grouped.values()].map(({ row, count, sumUptime, sumSpeed, sumQuality }) => {
      row.uptimePct = sumUptime / count
      row.speedToOptimumPct = sumSpeed / count
      row.qualityPct = sumQuality / count
      row.oeePct = (row.uptimePct / 100) * (row.speedToOptimumPct / 100) * (row.qualityPct / 100) * 100
      return row
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oeeDetailData, groupByDims])

  const sortedOeeDetailData = useMemo(() => {
    return sortTableData(groupedOeeDetailData)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupedOeeDetailData, tableSort])

  const oeeDetailTotals = useMemo(() => {
    const rows = groupedOeeDetailData
    if (rows.length === 0) return null
    const totalOrderHours = rows.reduce((s: number, r) => s + r.orderHours, 0)
    const totalSetupCount = rows.reduce((s: number, r) => s + r.setupCount, 0)
    const avgUptimePct = rows.reduce((s: number, r) => s + r.uptimePct, 0) / rows.length
    const avgSpeedPct = rows.reduce((s: number, r) => s + r.speedToOptimumPct, 0) / rows.length
    const avgQualityPct = rows.reduce((s: number, r) => s + r.qualityPct, 0) / rows.length
    const avgOeePct = rows.reduce((s: number, r) => s + r.oeePct, 0) / rows.length
    return { orderHours: totalOrderHours, setupCount: totalSetupCount, uptimePct: avgUptimePct, speedToOptimumPct: avgSpeedPct, qualityPct: avgQualityPct, oeePct: avgOeePct }
  }, [groupedOeeDetailData])

  const resetFilters = useCallback(() => {
    setTimeWindow(getDefaultPreset("monthly"))
    setMachineFilter("all")
    setShiftFilter("all")
    setGranularity("monthly")
    setSelectedPeriod(null)
    setTableSort({ key: "producedSheets", dir: "desc" })
    setTableTab("machine")
    setDashboardTab("quality")
    setQualityChartTab("quality")
    setSpeedChartTab("speedToOptimum")
    setUptimeChartTab("uptimePct")
    setOeeChartTab("oeePct")
    setSpeedCustomerFilter("all")
    setSpeedSpecFilter("all")
    setSpeedJobFilter("all")
    setGroupByDims(["feedbackDate", "jobNum", "customerName", "specNumber", "lineNumber"])
  }, [setTimeWindow, setMachineFilter, setShiftFilter, setGranularity, setTableSort, setTableTab, setDashboardTab, setQualityChartTab, setSpeedChartTab, setUptimeChartTab, setOeeChartTab, setGroupByDims])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await queryClient.invalidateQueries({ queryKey: ["production"] })
    setLastUpdated(new Date())
    setIsRefreshing(false)
  }, [queryClient])

  // Set initial last-updated when first data arrives
  useEffect(() => {
    if (!lastUpdated && !summaryQuery.isLoading && summaryData.length > 0) {
      setLastUpdated(new Date())
    }
  }, [lastUpdated, summaryQuery.isLoading, summaryData.length])

  const chartLoading = isQuality ? summaryQuery.isLoading
    : isSpeed ? speedSummaryQuery.isLoading
    : isUptime ? uptimeSummaryQuery.isLoading
    : (summaryQuery.isLoading || speedSummaryQuery.isLoading || uptimeSummaryQuery.isLoading)
  const detailLoading = isQuality
    ? (qualityDetailQuery.isLoading || wasteByCategoryQuery.isLoading)
    : isSpeed ? (speedDetailQuery.isLoading || speedExceptionsQuery.isLoading)
    : isUptime ? uptimeDetailQuery.isLoading
    : oeeDetailQuery.isLoading
  const isLoading = chartLoading || detailLoading

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 -mx-6 -mt-6 pt-3 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate("/erp")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">OEE Dashboard</span>
        <div className="flex items-center gap-1">
          <Button
            variant={isQuality ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setDashboardTab("quality")}
          >
            Quality
          </Button>
          <Button
            variant={isSpeed ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setDashboardTab("speed")}
          >
            Speed
          </Button>
          <Button
            variant={isUptime ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setDashboardTab("uptime")}
          >
            Uptime
          </Button>
          <Button
            variant={isOee ? "default" : "outline"}
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setDashboardTab("oee")}
          >
            OEE
          </Button>
        </div>
        {selectedPeriod && (
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2.5 text-xs ml-1"
            onClick={() => setSelectedPeriod(null)}
          >
            {getPeriodLabel(selectedPeriod, granularity)} ✕
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <SearchableSelect
            value={machineFilter}
            onValueChange={setMachineFilter}
            options={machines.map((m) => String(m.machineNumber))}
            placeholder="All Machines"
            searchPlaceholder="Search machines..."
            width="w-[200px]"
            getLabel={(v) => machines.find((m) => String(m.machineNumber) === v)?.machineName ?? v}
          />

          <SearchableSelect
            value={shiftFilter}
            onValueChange={setShiftFilter}
            options={shifts.map((s) => s.shiftName)}
            placeholder="All Shifts"
            searchPlaceholder="Search shifts..."
            width="w-[120px]"
          />

          <TimePresetBar
            granularity={granularity}
            value={timeWindow}
            onChange={setTimeWindow}
            dateLimits={prodLimits ? { minDate: prodLimits.minDate, maxDate: prodLimits.maxDate } : null}
            customRange={customRange}
            onCustomRangeChange={(s, e) => { setCustomStart(s); setCustomEnd(e) }}
          />

          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetFilters} title="Reset filters">
            <RotateCcw className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-1.5 border-l border-border pl-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleRefresh} disabled={isRefreshing} title="Refresh data">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            </Button>
            {lastUpdated && (
              <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      {isQuality ? (
        <div key="quality-kpis" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            title="Quality %"
            value={formatPercent(kpis.qualityPct)}
            tooltip="Produced Sheets / (Produced Sheets + Reported Waste)"
          />
          <KpiCard
            title="Produced Sheets"
            value={formatNumber(kpis.producedSheets)}
            tooltip="quantity_produced / (number_up_entry / number_up_exit)"
          />
          <KpiCard
            title="Waste Sheets"
            value={formatNumber(kpis.wasteSheets)}
            tooltip="From dwwaste (waste_property != 0, capped at 200k/step)"
          />
          <KpiCard
            title="Waste %"
            value={formatPercent(kpis.wastePct)}
            tooltip="Waste / (Produced Sheets + Waste)"
          />
          <KpiCard
            title="Produced Qty"
            value={formatNumber(kpis.producedQty)}
            tooltip="Raw quantity_produced (before number_out division)"
          />
          <KpiCard
            title="Fed Qty"
            value={formatNumber(kpis.fedQty)}
            tooltip="Total quantity_fed_in across all feedback"
          />
        </div>
      ) : isSpeed ? (
        <div key="speed-kpis" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard
            title="Speed to Optimum %"
            value={formatPercent(speedKpis.speedToOptimum)}
            tooltip="Sheets Per Hour / Optimum Run Speed"
          />
          <KpiCard
            title="Sheets Per Hour"
            value={formatNumber(speedKpis.sheetsPerHour, 0)}
            tooltip="Total Fed In / Uptime Hours"
          />
          <KpiCard
            title="Optimum Speed"
            value={formatNumber(speedKpis.avgOptimumSpeed, 0)}
            tooltip="Average optimum_run_speed from dwcostcenters (machine 154 = 15,000)"
          />
          <KpiCard
            title="Total Fed In"
            value={formatNumber(speedKpis.totalFedIn)}
            tooltip="Total quantity_fed_in"
          />
          <KpiCard
            title="Uptime Hours"
            value={formatNumber(speedKpis.uptimeHours, 1)}
            tooltip="Order Hours - Setup Hours - Open Downtime - Closed Downtime"
          />
        </div>
      ) : isUptime ? (
        <div key="uptime-kpis" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
          <KpiCard
            title="Uptime %"
            value={formatPercent(uptimeKpis.uptimePct)}
            tooltip="Uptime Hours / Run Hours"
          />
          <KpiCard
            title="Uptime Hours"
            value={formatNumber(uptimeKpis.uptimeHours, 1)}
            tooltip="Run Hours - Downtime Open - Downtime Closed"
          />
          <KpiCard
            title="Run Hours"
            value={formatNumber(uptimeKpis.runHours, 1)}
            tooltip="Order Hours - Setup Hours"
          />
          <KpiCard
            title="Order Hours"
            value={formatNumber(uptimeKpis.orderHours, 1)}
            tooltip="Total feedback duration (start to finish)"
          />
          <KpiCard
            title="Setup Hours"
            value={formatNumber(uptimeKpis.setupHours, 1)}
            tooltip="Setup duration minus downtime during setup"
          />
          <KpiCard
            title="Downtime Open"
            value={formatNumber(uptimeKpis.downtimeOpen, 1)}
            tooltip="Mechanical issues, jams, unplanned stoppages"
          />
          <KpiCard
            title="Downtime Closed"
            value={formatNumber(uptimeKpis.downtimeClosed, 1)}
            tooltip="Scheduled breaks, lunch, planned stoppages"
          />
        </div>
      ) : (
        <div key="oee-kpis" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            title="OEE %"
            value={formatPercent(oeeKpis.oeePct)}
            tooltip="Quality % x Speed % x Uptime %"
          />
          <KpiCard
            title="Quality %"
            value={formatPercent(oeeKpis.qualityPct)}
            tooltip="Produced Sheets / (Produced + Waste)"
          />
          <KpiCard
            title="Speed %"
            value={formatPercent(oeeKpis.speedPct)}
            tooltip="Sheets Per Hour / Optimum Run Speed"
          />
          <KpiCard
            title="Uptime %"
            value={formatPercent(oeeKpis.uptimePct)}
            tooltip="Uptime Hours / Run Hours"
          />
          <KpiCard
            title="Produced Sheets"
            value={formatNumber(oeeKpis.producedSheets)}
            tooltip="Total produced sheets across all machines"
          />
          <KpiCard
            title="Run Hours"
            value={formatNumber(oeeKpis.runHours, 1)}
            tooltip="Order Hours - Setup Hours"
          />
        </div>
      )}

      {/* Main Charts Row */}
      {isQuality ? (
        <div key="quality-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Quality % Trend — Tabbed Area Chart */}
          <Card className="lg:col-span-2 bg-background-secondary">
            <Tabs value={qualityChartTab} onValueChange={setQualityChartTab}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Quality Trend</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {(["yearly", "monthly", "weekly", "daily"] as Granularity[]).map((g) => (
                        <Button key={g} variant={granularity === g ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" onClick={() => setGranularity(g)}>
                          {g[0].toUpperCase()}
                        </Button>
                      ))}
                    </div>
                    <TabsList>
                      <TabsTrigger value="quality">Quality %</TabsTrigger>
                      <TabsTrigger value="produced">Produced</TabsTrigger>
                      <TabsTrigger value="waste">Waste</TabsTrigger>
                    </TabsList>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {chartLoading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                  <div style={needsScroll ? { width: chartWidth } : undefined}>
                    <TabsContent value="quality" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradQuality" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="qualityPct" name="Quality %" stroke="#6366f1" fill="url(#gradQuality)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="qualityPct" content={renderAreaLabel(formatPercent)} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="produced" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradProduced" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatNumber(v)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatNumber(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="producedSheets" name="Produced Sheets" stroke="#6366f1" fill="url(#gradProduced)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="producedSheets" content={renderAreaLabel(formatNumber)} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="waste" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradWaste" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatNumber(v)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatNumber(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="wasteSheets" name="Waste Sheets" stroke="#6366f1" fill="url(#gradWaste)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="wasteSheets" content={renderAreaLabel(formatNumber)} />
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

          {/* Waste by Category — Horizontal Bar */}
          <Card className="bg-background-secondary">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Waste by Category</CardTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />Wasted Sheets</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {wasteByCategoryQuery.isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : wasteCategoryBarData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  No waste data for this period
                </div>
              ) : (
                <div className="px-4 pb-4">
                  <div className="overflow-y-auto overflow-x-hidden max-h-[250px]">
                    <ResponsiveContainer width="100%" height={wasteCategoryBarHeight}>
                      <BarChart data={wasteCategoryBarData} layout="vertical" margin={{ left: 10, right: 70 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fontSize: 11 }} />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [formatNumber(value), name]) as any}
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                          cursor={{ fill: "var(--color-bg-hover)" }}
                        />
                        <Bar dataKey="wasteSheets" name="Wasted Sheets" fill="#6366f1" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                          <LabelList dataKey="wasteSheets" position="right" fill="var(--color-text)" fontSize={11} formatter={((v: number) => formatNumber(v)) as never} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : isSpeed ? (
        <div key="speed-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Speed Trend — Tabbed Area Chart */}
          <Card className="lg:col-span-2 bg-background-secondary">
            <Tabs value={speedChartTab} onValueChange={setSpeedChartTab}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Speed Trend</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {(["yearly", "monthly", "weekly", "daily"] as Granularity[]).map((g) => (
                        <Button key={g} variant={granularity === g ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" onClick={() => setGranularity(g)}>
                          {g[0].toUpperCase()}
                        </Button>
                      ))}
                    </div>
                    <TabsList>
                      <TabsTrigger value="speedToOptimum">Speed %</TabsTrigger>
                      <TabsTrigger value="sheetsPerHour">Sheets/Hr</TabsTrigger>
                    </TabsList>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {chartLoading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                  <div style={needsScroll ? { width: chartWidth } : undefined}>
                    <TabsContent value="speedToOptimum" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={speedChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradSpeedOpt" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="speedToOptimum" name="Speed to Optimum %" stroke="#6366f1" fill="url(#gradSpeedOpt)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="speedToOptimum" content={renderAreaLabel(formatPercent)} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="sheetsPerHour" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={speedChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradSPH" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatNumber(v)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatNumber(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="sheetsPerHour" name="Sheets Per Hour" stroke="#6366f1" fill="url(#gradSPH)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="sheetsPerHour" content={renderAreaLabel(formatNumber)} />
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

          {/* Speed to Optimum by Machine — Horizontal Bar */}
          <Card className="bg-background-secondary">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Speed by Machine</CardTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />Speed to Optimum %</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {speedByMachineQuery.isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : speedMachineBarData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  No speed data for this period
                </div>
              ) : (
                <div className="px-4 pb-4">
                  <div className="overflow-y-auto overflow-x-hidden max-h-[250px]">
                    <ResponsiveContainer width="100%" height={speedMachineBarHeight}>
                      <BarChart
                        data={speedMachineBarData}
                        layout="vertical"
                        margin={{ left: 10, right: 70 }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onClick={(data: any) => {
                          const machineNum = data?.activePayload?.[0]?.payload?.machineNumber
                          if (machineNum != null) {
                            setMachineFilter((prev) => prev === String(machineNum) ? "all" : String(machineNum))
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fontSize: 11 }} />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                          cursor={{ fill: "var(--color-bg-hover)" }}
                        />
                        <Bar dataKey="speedToOptimum" name="Speed to Optimum %" fill="#6366f1" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                          {speedMachineBarData.map((d, i) => (
                            <Cell key={i} fill={machineFilter !== "all" && String(d.machineNumber) !== machineFilter ? "#6366f133" : "#6366f1"} />
                          ))}
                          <LabelList dataKey="speedToOptimum" position="right" fill="var(--color-text)" fontSize={11} formatter={((v: number) => formatPercent(v)) as never} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : isUptime ? (
        <div key="uptime-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Uptime Trend — Tabbed Area Chart */}
          <Card className="lg:col-span-2 bg-background-secondary">
            <Tabs value={uptimeChartTab} onValueChange={setUptimeChartTab}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Uptime Trend</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {(["yearly", "monthly", "weekly", "daily"] as Granularity[]).map((g) => (
                        <Button key={g} variant={granularity === g ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" onClick={() => setGranularity(g)}>
                          {g[0].toUpperCase()}
                        </Button>
                      ))}
                    </div>
                    <TabsList>
                      <TabsTrigger value="uptimePct">Uptime %</TabsTrigger>
                      <TabsTrigger value="runHours">Run Hours</TabsTrigger>
                      <TabsTrigger value="downtime">Downtime</TabsTrigger>
                    </TabsList>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {chartLoading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                  <div style={needsScroll ? { width: chartWidth } : undefined}>
                    <TabsContent value="uptimePct" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={uptimeChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradUptimePct" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="uptimePct" name="Uptime %" stroke="#6366f1" fill="url(#gradUptimePct)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="uptimePct" content={renderAreaLabel(formatPercent)} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="runHours" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={uptimeChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradRunHrsUp" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatNumber(v, 1)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatNumber(value, 1), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="runHours" name="Run Hours" stroke="#6366f1" fill="url(#gradRunHrsUp)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="runHours" content={renderAreaLabel((v) => formatNumber(v, 1))} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="downtime" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={uptimeChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradDtOpen" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.05} />
                            </linearGradient>
                            <linearGradient id="gradDtClosed" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis tickFormatter={(v) => formatNumber(v, 1)} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatNumber(value, 1), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="downtimeOpen" name="Downtime Open" stroke="#a78bfa" fill="url(#gradDtOpen)" strokeWidth={2.5} dot={{ r: 4, fill: "#a78bfa", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
                          <Area type="monotone" dataKey="downtimeClosed" name="Downtime Closed" stroke="#6366f1" fill="url(#gradDtClosed)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                  </div>
                  </div>
                )}
              </CardContent>
            </Tabs>
          </Card>

          {/* Downtime by Reason — Horizontal Bar */}
          <Card className="bg-background-secondary">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Downtime by Reason</CardTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#a78bfa]" />Hours</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {downtimeByReasonQuery.isLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : downtimeReasonData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  No downtime data for this period
                </div>
              ) : (
                <div className="px-4 pb-4">
                  <div className="overflow-y-auto overflow-x-hidden max-h-[250px]">
                    <ResponsiveContainer width="100%" height={downtimeReasonBarHeight}>
                      <BarChart
                        data={downtimeReasonData}
                        layout="vertical"
                        margin={{ left: 10, right: 70 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="className" width={140} className="text-xs" tick={{ fontSize: 11 }} />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [`${formatNumber(value, 1)} hrs`, name]) as any}
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                          cursor={{ fill: "var(--color-bg-hover)" }}
                        />
                        <Bar dataKey="downtimeHours" name="Downtime" fill="#a78bfa" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                          <LabelList dataKey="downtimeHours" position="right" fill="var(--color-text)" fontSize={11} formatter={((v: number) => formatNumber(v, 1)) as never} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div key="oee-charts" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* OEE Trend — Tabbed Area Chart */}
          <Card className="lg:col-span-2 bg-background-secondary">
            <Tabs value={oeeChartTab} onValueChange={setOeeChartTab}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">OEE Trend</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      {(["yearly", "monthly", "weekly", "daily"] as Granularity[]).map((g) => (
                        <Button key={g} variant={granularity === g ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" onClick={() => setGranularity(g)}>
                          {g[0].toUpperCase()}
                        </Button>
                      ))}
                    </div>
                    <TabsList>
                      <TabsTrigger value="oeePct">OEE %</TabsTrigger>
                      <TabsTrigger value="components">Components</TabsTrigger>
                    </TabsList>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {chartLoading ? (
                  <div className="h-[300px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : (
                  <div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
                  <div style={needsScroll ? { width: chartWidth } : undefined}>
                    <TabsContent value="oeePct" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={oeeChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradOee" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="oeePct" name="OEE %" stroke="#6366f1" fill="url(#gradOee)" strokeWidth={2.5} dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false}>
                            <LabelList dataKey="oeePct" content={renderAreaLabel(formatPercent)} />
                          </Area>
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                    <TabsContent value="components" className="mt-0">
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={oeeChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
                          <defs>
                            <linearGradient id="gradCompQuality" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="gradCompSpeed" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                            </linearGradient>
                            <linearGradient id="gradCompUptime" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="label" className="text-xs" tickLine={false} />
                          <YAxis domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} className="text-xs" />
                          <RechartsTooltip
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                            contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                            labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                            itemStyle={{ color: "var(--color-text)" }}
                          />
                          <Legend />
                          {dimRegions?.left && <ReferenceArea x1={dimRegions.left.x1} x2={dimRegions.left.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          {dimRegions?.right && <ReferenceArea x1={dimRegions.right.x1} x2={dimRegions.right.x2} fill="#000" fillOpacity={0.35} ifOverflow="visible" />}
                          <Area type="monotone" dataKey="qualityPct" name="Quality %" stroke="#6366f1" fill="url(#gradCompQuality)" strokeWidth={2} dot={{ r: 3, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
                          <Area type="monotone" dataKey="speedPct" name="Speed %" stroke="#a78bfa" fill="url(#gradCompSpeed)" strokeWidth={2} dot={{ r: 3, fill: "#a78bfa", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
                          <Area type="monotone" dataKey="uptimePct" name="Uptime %" stroke="#a78bfa" fill="url(#gradCompUptime)" strokeWidth={2} dot={{ r: 3, fill: "#a78bfa", stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </TabsContent>
                  </div>
                  </div>
                )}
              </CardContent>
            </Tabs>
          </Card>

          {/* OEE by Machine — Horizontal Bar */}
          <Card className="bg-background-secondary">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">OEE by Machine</CardTitle>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />OEE %</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {(speedByMachineQuery.isLoading || uptimeByMachineQuery.isLoading) ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : oeeMachineBarData.length === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
                  No OEE data for this period
                </div>
              ) : (
                <div className="px-4 pb-4">
                  <div className="overflow-y-auto overflow-x-hidden max-h-[250px]">
                    <ResponsiveContainer width="100%" height={oeeMachineBarHeight}>
                      <BarChart
                        data={oeeMachineBarData}
                        layout="vertical"
                        margin={{ left: 10, right: 70 }}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onClick={(data: any) => {
                          const machineNum = data?.activePayload?.[0]?.payload?.machineNumber
                          if (machineNum != null) {
                            setMachineFilter((prev) => prev === String(machineNum) ? "all" : String(machineNum))
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                        <XAxis type="number" hide />
                        <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fontSize: 11 }} />
                        <RechartsTooltip
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          formatter={((value: number, name: string) => [formatPercent(value), name]) as any}
                          contentStyle={{ backgroundColor: "var(--color-bg-secondary)", borderColor: "var(--border)", borderRadius: 8 }}
                          labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
                          itemStyle={{ color: "var(--color-text)" }}
                          cursor={{ fill: "var(--color-bg-hover)" }}
                        />
                        <Bar dataKey="oeePct" name="OEE %" fill="#6366f1" radius={[0, 2, 2, 0]} isAnimationActive={false}>
                          {oeeMachineBarData.map((d, i) => (
                            <Cell key={i} fill={machineFilter !== "all" && String(d.machineNumber) !== machineFilter ? "#6366f133" : "#6366f1"} />
                          ))}
                          <LabelList dataKey="oeePct" position="right" fill="var(--color-text)" fontSize={11} formatter={((v: number) => formatPercent(v)) as never} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detail Table — Tabbed by Machine / Shift */}
      <Card className="bg-background-secondary">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-3 flex-wrap">
            <CardTitle className="text-base">{isQuality ? "Production Detail" : isSpeed ? "Speed Detail" : isUptime ? "Uptime Detail" : "OEE Detail"}</CardTitle>
            <div className="flex items-center gap-1 ml-auto">
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
            {isSpeed && (
              <div className="flex items-center gap-2 flex-wrap">
                <SearchableSelect
                  value={speedCustomerFilter}
                  onValueChange={setSpeedCustomerFilter}
                  options={speedDetailSlicerOptions.customers}
                  placeholder="All Customers"
                  searchPlaceholder="Search customers..."
                  width="w-[160px]"
                  popoverWidth="w-[220px]"
                />
                <SearchableSelect
                  value={speedSpecFilter}
                  onValueChange={setSpeedSpecFilter}
                  options={speedDetailSlicerOptions.specs}
                  placeholder="All Specs"
                  searchPlaceholder="Search specs..."
                  width="w-[140px]"
                  popoverWidth="w-[200px]"
                />
                <SearchableSelect
                  value={speedJobFilter}
                  onValueChange={setSpeedJobFilter}
                  options={speedDetailSlicerOptions.jobs}
                  placeholder="All Jobs"
                  searchPlaceholder="Search jobs..."
                  width="w-[140px]"
                  popoverWidth="w-[200px]"
                />
                {/* Clear all slicers */}
                {(speedCustomerFilter !== "all" || speedSpecFilter !== "all" || speedJobFilter !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 text-xs text-muted-foreground"
                    onClick={() => { setSpeedCustomerFilter("all"); setSpeedSpecFilter("all"); setSpeedJobFilter("all") }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto [&_td]:py-1.5 [&_th]:py-1.5">
            {isQuality ? (
                <Table>
                  <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                    <TableRow>
                      {groupByDimOptions.map(([dim, label]) =>
                        groupByDims.includes(dim) ? (
                          <TableHead key={dim} className="cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleTableSort(dim)}>
                            {label} {tableSort.key === dim && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                          </TableHead>
                        ) : null
                      )}
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("reportedWaste")}>
                        Reported Waste {tableSort.key === "reportedWaste" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("prerunWaste")}>
                        Prerun Waste {tableSort.key === "prerunWaste" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("producedSheets")}>
                        Produced Sheets {tableSort.key === "producedSheets" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("qualityPct")}>
                        Quality % {tableSort.key === "qualityPct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedQualityDetailData.map((r, i) => (
                      <TableRow key={i}>
                        {groupByDimOptions.map(([dim]) =>
                          groupByDims.includes(dim) ? (
                            <TableCell key={dim} className={dim === "customerName" ? "whitespace-nowrap max-w-[150px] truncate" : "whitespace-nowrap"}>
                              {String((r as unknown as Record<string, unknown>)[dim] ?? "")}
                            </TableCell>
                          ) : null
                        )}
                        <TableCell className="text-right">{formatNumber(r.reportedWaste)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.prerunWaste)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.producedSheets)}</TableCell>
                        <TableCell className="text-right">
                          <span className={r.qualityPct >= 95 ? "text-green-500" : r.qualityPct >= 90 ? "text-yellow-500" : "text-red-500"}>
                            {formatPercent(r.qualityPct)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                    {sortedQualityDetailData.length === 0 && !isLoading && (
                      <TableRow>
                        <TableCell colSpan={groupByDims.length + 4} className="text-center text-muted-foreground py-8">
                          No quality data for this period
                        </TableCell>
                      </TableRow>
                    )}

                    </TableBody>

                    {qualityDetailTotals && (
                      <TableFooter className="sticky bottom-0 z-10">
                        <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={groupByDims.length || 1}>Totals</TableCell>
                        <TableCell className="text-right">{formatNumber(qualityDetailTotals.reportedWaste)}</TableCell>
                        <TableCell className="text-right">{formatNumber(qualityDetailTotals.prerunWaste)}</TableCell>
                        <TableCell className="text-right">{formatNumber(qualityDetailTotals.producedSheets)}</TableCell>
                        <TableCell className="text-right">
                          <span className={qualityDetailTotals.qualityPct >= 95 ? "text-green-500" : qualityDetailTotals.qualityPct >= 90 ? "text-yellow-500" : "text-red-500"}>
                            {formatPercent(qualityDetailTotals.qualityPct)}
                          </span>
                        </TableCell>
                      </TableRow>
                      </TableFooter>

                    )}
                </Table>
            ) : isSpeed ? (
                <Table>
                  <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                    <TableRow>
                      {groupByDimOptions.map(([dim, label]) =>
                        groupByDims.includes(dim) ? (
                          <TableHead key={dim} className="cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleTableSort(dim)}>
                            {label} {tableSort.key === dim && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                          </TableHead>
                        ) : null
                      )}
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("speedToOptimumPct")}>
                        Speed % {tableSort.key === "speedToOptimumPct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("speedToOptimumOrderPct")}>
                        Speed % (Ord) {tableSort.key === "speedToOptimumOrderPct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("speedSheetsPerHour")}>
                        Sheets/Hr {tableSort.key === "speedSheetsPerHour" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("speedSheetsPerOrderHour")}>
                        Sheets/Ord Hr {tableSort.key === "speedSheetsPerOrderHour" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("uptimeHours")}>
                        Uptime Hrs {tableSort.key === "uptimeHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("actualSpeed")}>
                        Actual Spd {tableSort.key === "actualSpeed" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("optimumRunSpeed")}>
                        Optimum Spd {tableSort.key === "optimumRunSpeed" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("orderHours")}>
                        Order Hrs {tableSort.key === "orderHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("uptimePct")}>
                        Uptime % {tableSort.key === "uptimePct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSpeedDetailData.map((r, i) => (
                      <TableRow key={i}>
                        {groupByDimOptions.map(([dim]) =>
                          groupByDims.includes(dim) ? (
                            <TableCell key={dim} className={dim === "customerName" ? "whitespace-nowrap max-w-[150px] truncate" : "whitespace-nowrap"}>
                              {String((r as unknown as Record<string, unknown>)[dim] ?? "")}
                            </TableCell>
                          ) : null
                        )}
                        <TableCell className="text-right">{formatPercent(r.speedToOptimumPct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.speedToOptimumOrderPct)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.speedSheetsPerHour, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.speedSheetsPerOrderHour, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.uptimeHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.actualSpeed, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.optimumRunSpeed, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.orderHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.uptimePct)}</TableCell>
                      </TableRow>
                    ))}
                    {sortedSpeedDetailData.length === 0 && !isLoading && (
                      <TableRow>
                        <TableCell colSpan={groupByDims.length + 9} className="text-center text-muted-foreground py-8">
                          No speed data for this period
                        </TableCell>
                      </TableRow>
                    )}

                    </TableBody>

                    {speedDetailTotals && (
                      <TableFooter className="sticky bottom-0 z-10">
                        <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={groupByDims.length || 1}>Totals</TableCell>
                        <TableCell className="text-right">{formatPercent(speedDetailTotals.speedToOptimumPct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(speedDetailTotals.speedToOptimumOrderPct)}</TableCell>
                        <TableCell className="text-right">{formatNumber(speedDetailTotals.speedSheetsPerHour, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(speedDetailTotals.speedSheetsPerOrderHour, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(speedDetailTotals.uptimeHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(speedDetailTotals.actualSpeed, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(speedDetailTotals.optimumRunSpeed, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(speedDetailTotals.orderHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatPercent(speedDetailTotals.uptimePct)}</TableCell>
                      </TableRow>
                      </TableFooter>

                    )}
                </Table>
            ) : isUptime ? (
                <Table>
                  <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                    <TableRow>
                      {groupByDimOptions.map(([dim, label]) =>
                        groupByDims.includes(dim) ? (
                          <TableHead key={dim} className="cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleTableSort(dim)}>
                            {label} {tableSort.key === dim && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                          </TableHead>
                        ) : null
                      )}
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("setupHours")}>
                        Setup Hrs {tableSort.key === "setupHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("runHours")}>
                        Run Hrs {tableSort.key === "runHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("downtimeHours")}>
                        Downtime Hrs {tableSort.key === "downtimeHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("orderHours")}>
                        Order Hrs {tableSort.key === "orderHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("uptimeHours")}>
                        Uptime Hrs {tableSort.key === "uptimeHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("setupPct")}>
                        Setup % {tableSort.key === "setupPct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("uptimePct")}>
                        Uptime % {tableSort.key === "uptimePct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("downtimePct")}>
                        Downtime % {tableSort.key === "downtimePct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedUptimeDetailData.map((r, i) => (
                      <TableRow key={i}>
                        {groupByDimOptions.map(([dim]) =>
                          groupByDims.includes(dim) ? (
                            <TableCell key={dim} className={dim === "customerName" ? "whitespace-nowrap max-w-[150px] truncate" : "whitespace-nowrap"}>
                              {String((r as unknown as Record<string, unknown>)[dim] ?? "")}
                            </TableCell>
                          ) : null
                        )}
                        <TableCell className="text-right">{formatNumber(r.setupHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.runHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.downtimeHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.orderHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.uptimeHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.setupPct)}</TableCell>
                        <TableCell className="text-right">
                          <span className={r.uptimePct >= 90 ? "text-green-500" : r.uptimePct >= 70 ? "text-yellow-500" : "text-red-500"}>
                            {formatPercent(r.uptimePct)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatPercent(r.downtimePct)}</TableCell>
                      </TableRow>
                    ))}
                    {sortedUptimeDetailData.length === 0 && !isLoading && (
                      <TableRow>
                        <TableCell colSpan={groupByDims.length + 8} className="text-center text-muted-foreground py-8">
                          No uptime data for this period
                        </TableCell>
                      </TableRow>
                    )}

                    </TableBody>

                    {uptimeDetailTotals && (
                      <TableFooter className="sticky bottom-0 z-10">
                        <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={groupByDims.length || 1}>Totals</TableCell>
                        <TableCell className="text-right">{formatNumber(uptimeDetailTotals.setupHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(uptimeDetailTotals.runHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(uptimeDetailTotals.downtimeHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(uptimeDetailTotals.orderHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatNumber(uptimeDetailTotals.uptimeHours, 2)}</TableCell>
                        <TableCell className="text-right">{formatPercent(uptimeDetailTotals.setupPct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(uptimeDetailTotals.uptimePct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(uptimeDetailTotals.downtimePct)}</TableCell>
                      </TableRow>
                      </TableFooter>

                    )}
                </Table>
            ) : (
                <Table>
                  <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                    <TableRow>
                      {groupByDimOptions.map(([dim, label]) =>
                        groupByDims.includes(dim) ? (
                          <TableHead key={dim} className="cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleTableSort(dim)}>
                            {label} {tableSort.key === dim && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                          </TableHead>
                        ) : null
                      )}
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("uptimePct")}>
                        Uptime % {tableSort.key === "uptimePct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("speedToOptimumPct")}>
                        Speed % {tableSort.key === "speedToOptimumPct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("qualityPct")}>
                        Quality % {tableSort.key === "qualityPct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("oeePct")}>
                        OEE % {tableSort.key === "oeePct" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("setupCount")}>
                        Setup Count {tableSort.key === "setupCount" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right whitespace-nowrap" onClick={() => handleTableSort("orderHours")}>
                        Order Hrs {tableSort.key === "orderHours" && (tableSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedOeeDetailData.map((r, i) => (
                      <TableRow key={i}>
                        {groupByDimOptions.map(([dim]) =>
                          groupByDims.includes(dim) ? (
                            <TableCell key={dim} className={dim === "customerName" ? "whitespace-nowrap max-w-[150px] truncate" : "whitespace-nowrap"}>
                              {String((r as unknown as Record<string, unknown>)[dim] ?? "")}
                            </TableCell>
                          ) : null
                        )}
                        <TableCell className="text-right">{formatPercent(r.uptimePct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.speedToOptimumPct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(r.qualityPct)}</TableCell>
                        <TableCell className="text-right">
                          <span className={r.oeePct >= 70 ? "text-green-500" : r.oeePct >= 50 ? "text-yellow-500" : "text-red-500"}>
                            {formatPercent(r.oeePct)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{r.setupCount}</TableCell>
                        <TableCell className="text-right">{formatNumber(r.orderHours, 2)}</TableCell>
                      </TableRow>
                    ))}
                    {sortedOeeDetailData.length === 0 && !isLoading && (
                      <TableRow>
                        <TableCell colSpan={groupByDims.length + 6} className="text-center text-muted-foreground py-8">
                          No OEE data for this period
                        </TableCell>
                      </TableRow>
                    )}

                    </TableBody>

                    {oeeDetailTotals && (
                      <TableFooter className="sticky bottom-0 z-10">
                        <TableRow className="font-bold border-t-2">
                        <TableCell colSpan={groupByDims.length || 1}>Totals / Averages</TableCell>
                        <TableCell className="text-right">{formatPercent(oeeDetailTotals.uptimePct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(oeeDetailTotals.speedToOptimumPct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(oeeDetailTotals.qualityPct)}</TableCell>
                        <TableCell className="text-right">{formatPercent(oeeDetailTotals.oeePct)}</TableCell>
                        <TableCell className="text-right">{oeeDetailTotals.setupCount}</TableCell>
                        <TableCell className="text-right">{formatNumber(oeeDetailTotals.orderHours, 2)}</TableCell>
                      </TableRow>
                      </TableFooter>

                    )}
                </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Speed Exceptions — rows excluded by above-optimum filter */}
      {isSpeed && (
        <Card className="bg-background-secondary">
          <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setExceptionsOpen((o) => !o)}>
            <div className="flex items-center gap-2">
              <ChevronDown className={`h-4 w-4 transition-transform ${exceptionsOpen ? "" : "-rotate-90"}`} />
              <CardTitle className="text-base">Excluded Rows (Above Optimum)</CardTitle>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/10 text-red-500">
                {sortedExceptionsData.length}
              </span>
            </div>
          </CardHeader>
          {exceptionsOpen && (
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[400px] overflow-y-auto [&_td]:py-1.5 [&_th]:py-1.5">
                <Table>
                  <TableHeader className="sticky top-0 z-10 [&_th]:bg-[var(--color-bg-secondary)]">
                    <TableRow>
                      <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleExceptionsSort("feedDate")}>
                        Date {exceptionsSort.key === "feedDate" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleExceptionsSort("machineName")}>
                        Machine {exceptionsSort.key === "machineName" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleExceptionsSort("shiftName")}>
                        Shift {exceptionsSort.key === "shiftName" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleExceptionsSort("fedIn")}>
                        Fed In {exceptionsSort.key === "fedIn" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleExceptionsSort("runHours")}>
                        Run Hrs {exceptionsSort.key === "runHours" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleExceptionsSort("actualSpeed")}>
                        Actual Speed {exceptionsSort.key === "actualSpeed" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleExceptionsSort("optimumSpeed")}>
                        Optimum {exceptionsSort.key === "optimumSpeed" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                      <TableHead className="cursor-pointer hover:text-foreground text-right" onClick={() => handleExceptionsSort("pctOver")}>
                        % Over {exceptionsSort.key === "pctOver" && (exceptionsSort.dir === "asc" ? "\u2191" : "\u2193")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedExceptionsData.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{row.feedDate?.slice(0, 10)}</TableCell>
                        <TableCell>{row.machineName}</TableCell>
                        <TableCell>{row.shiftName}</TableCell>
                        <TableCell className="text-right">{formatNumber(row.fedIn)}</TableCell>
                        <TableCell className="text-right">{formatNumber(row.runHours, 1)}</TableCell>
                        <TableCell className="text-right text-red-500">{formatNumber(row.actualSpeed, 0)}</TableCell>
                        <TableCell className="text-right">{formatNumber(row.optimumSpeed, 0)}</TableCell>
                        <TableCell className="text-right text-red-500">{formatPercent(row.pctOver)}</TableCell>
                      </TableRow>
                    ))}
                    {sortedExceptionsData.length === 0 && !speedExceptionsQuery.isLoading && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No rows exceeded optimum speed in this period
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  )
}
