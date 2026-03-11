import { useState, useEffect, useMemo, useCallback } from "react"
import {
  Maximize,
  Minimize,
  RefreshCw,
  Settings,
  Monitor,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  useTvData,
  useTvGoals,
  useUpdateTvGoals,
  type TvDataRow,
  type TvGoal,
} from "@/api/hooks/usePlantTvDashboard"
import { useAuth } from "@/contexts/AuthContext"

// ── Constants ─────────────────────────────────────────────────────────

const MACHINES = [131, 132, 133, 142, 144, 146, 154] as const

const DEFAULT_GOALS: Record<number, { pct85: number; pct90: number; pct100: number; pct112: number }> = {
  131: { pct85: 1514, pct90: 1603, pct100: 1781, pct112: 1995 },
  132: { pct85: 778, pct90: 824, pct100: 915, pct112: 1025 },
  133: { pct85: 1038, pct90: 1099, pct100: 1221, pct112: 1368 },
  142: { pct85: 2652, pct90: 2808, pct100: 3120, pct112: 3494 },
  144: { pct85: 2440, pct90: 2584, pct100: 2871, pct112: 3216 },
  146: { pct85: 938, pct90: 993, pct100: 1103, pct112: 1236 },
  154: { pct85: 2122, pct90: 2246, pct100: 2496, pct112: 2796 },
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString()
}

function getDateRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - 14) // 2 weeks back for MTD/weekly data
  const end = new Date(now)
  end.setDate(end.getDate() + 1)
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  }
}

function buildGoalsMap(goals: TvGoal[]): Record<number, { pct85: number; pct90: number; pct100: number; pct112: number }> {
  const map: Record<number, { pct85: number; pct90: number; pct100: number; pct112: number }> = {}
  for (const g of goals) {
    map[g.machine] = { pct85: g.pct85, pct90: g.pct90, pct100: g.pct100, pct112: g.pct112 }
  }
  for (const m of MACHINES) {
    if (!map[m]) map[m] = DEFAULT_GOALS[m]
  }
  return map
}

function getStatusColor(value: number, goal100: number, goal85: number): string {
  if (value >= goal100) return "#10b981" // emerald
  if (value >= goal85) return "#eab308" // yellow
  return "#ef4444" // red
}

function getStatusLabel(value: number, goal100: number, goal85: number): string {
  if (value >= goal100) return "On Target"
  if (value >= goal85) return "Close"
  return "Under"
}

// ── SVG Gauge Component ──────────────────────────────────────────────

function Gauge({
  value,
  maxValue,
  goal85,
  goal100,
  size = 220,
}: {
  value: number
  maxValue: number
  goal85: number
  goal100: number
  size?: number
}) {
  const cx = size / 2
  const cy = size / 2 + 8
  const r = size / 2 - 20
  const strokeWidth = 18

  // Arc from 180° (left) to 0° (right) — semicircle
  const startAngle = Math.PI
  const endAngle = 0
  const totalAngle = Math.PI

  const clampedValue = Math.min(value, maxValue)
  const valueAngle = startAngle - (clampedValue / maxValue) * totalAngle

  // Arc helper — sweep=1 draws clockwise in SVG (left-to-right across top)
  const arcPath = (fromAngle: number, toAngle: number) => {
    const x1 = cx + r * Math.cos(fromAngle)
    const y1 = cy - r * Math.sin(fromAngle)
    const x2 = cx + r * Math.cos(toAngle)
    const y2 = cy - r * Math.sin(toAngle)
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
  }

  // Goal tick marks
  const tickAngle85 = startAngle - (goal85 / maxValue) * totalAngle
  const tickAngle100 = startAngle - (goal100 / maxValue) * totalAngle

  const tickLine = (angle: number, len: number) => {
    const inner = r - len
    const outer = r + len
    return {
      x1: cx + inner * Math.cos(angle),
      y1: cy - inner * Math.sin(angle),
      x2: cx + outer * Math.cos(angle),
      y2: cy - outer * Math.sin(angle),
    }
  }

  const tick85 = tickLine(tickAngle85, 12)
  const tick100 = tickLine(tickAngle100, 12)

  // Label positions — placed outside the arc
  const labelRadius = r + strokeWidth / 2 + 14
  const label85 = {
    x: cx + labelRadius * Math.cos(tickAngle85),
    y: cy - labelRadius * Math.sin(tickAngle85),
  }
  const label100 = {
    x: cx + labelRadius * Math.cos(tickAngle100),
    y: cy - labelRadius * Math.sin(tickAngle100),
  }

  // Filled arc color
  const fillColor = getStatusColor(value, goal100, goal85)

  // Needle
  const needleAngle = startAngle - (clampedValue / maxValue) * totalAngle
  const needleLen = r - 20
  const nx = cx + needleLen * Math.cos(needleAngle)
  const ny = cy - needleLen * Math.sin(needleAngle)

  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 24}`} preserveAspectRatio="xMidYMid meet" className="tv-gauge-svg">
      {/* Background arc */}
      <path
        d={arcPath(startAngle, endAngle)}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Value arc */}
      {value > 0 && (
        <path
          d={arcPath(startAngle, valueAngle)}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${fillColor}40)` }}
        />
      )}
      {/* 85% tick */}
      <line
        x1={tick85.x1} y1={tick85.y1} x2={tick85.x2} y2={tick85.y2}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth={2}
      />
      {/* 100% tick */}
      <line
        x1={tick100.x1} y1={tick100.y1} x2={tick100.x2} y2={tick100.y2}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={2.5}
      />
      {/* 85% label */}
      <text
        x={label85.x} y={label85.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(255,255,255,0.35)"
        fontSize={10}
        fontWeight={500}
      >
        85%
      </text>
      {/* 100% label */}
      <text
        x={label100.x} y={label100.y}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="rgba(255,255,255,0.55)"
        fontSize={10}
        fontWeight={600}
      >
        100%
      </text>
      {/* Needle */}
      <line
        x1={cx} y1={cy} x2={nx} y2={ny}
        stroke="white"
        strokeWidth={2.5}
        strokeLinecap="round"
      />
      {/* Center dot */}
      <circle cx={cx} cy={cy} r={5} fill="white" />
    </svg>
  )
}

// ── Data aggregation ──────────────────────────────────────────────────

interface ShiftValue {
  shift: string
  value: number
}

interface MachineStats {
  lineNumber: number
  lineName: string
  currentShift: { value: number; shift: string; orderHours: number; sheetsFed: number } | null
  todayShifts: ShiftValue[]
  yesterday: { value: number; shifts: ShiftValue[] } | null
  lastWeek: number | null
  mtd: number | null
}

function aggregateStats(rows: TvDataRow[]): { machines: MachineStats[]; plant: MachineStats } {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

  // Current week start (Monday)
  const now = new Date()
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const thisMonday = new Date(now)
  thisMonday.setDate(now.getDate() - mondayOffset)
  const thisWeekStart = thisMonday.toISOString().slice(0, 10)

  // Last week
  const lastMonday = new Date(thisMonday)
  lastMonday.setDate(thisMonday.getDate() - 7)
  const lastWeekStart = lastMonday.toISOString().slice(0, 10)

  // Month start
  const monthStart = `${today.slice(0, 7)}-01`

  // Get machine names from first occurrence
  const machineNames: Record<number, string> = {}
  for (const r of rows) {
    if (!machineNames[r.lineNumber] && r.lineName) {
      machineNames[r.lineNumber] = r.lineName
    }
  }

  function calcForMachine(machineRows: TvDataRow[]): Omit<MachineStats, "lineNumber" | "lineName"> {
    // Current shift: latest entry for today
    const todayRows = machineRows.filter((r) => r.feedbackDate === today)
    const latestToday = todayRows.length > 0 ? todayRows[todayRows.length - 1] : null
    const currentShift = latestToday
      ? { value: latestToday.sheetsPerOrderHour, shift: latestToday.shiftName, orderHours: latestToday.totalOrderHours, sheetsFed: latestToday.totalSheetsFed }
      : null

    // All shifts for today
    const todayShifts: ShiftValue[] = todayRows.map((r) => ({ shift: r.shiftName, value: r.sheetsPerOrderHour }))

    // Yesterday: aggregate + per-shift
    const yesterdayRows = machineRows.filter((r) => r.feedbackDate === yesterday)
    let yesterdayData: MachineStats["yesterday"] = null
    if (yesterdayRows.length > 0) {
      const totalSheets = yesterdayRows.reduce((s, r) => s + r.totalSheetsFed, 0)
      const totalHours = yesterdayRows.reduce((s, r) => s + r.totalOrderHours, 0)
      yesterdayData = {
        value: totalHours > 0 ? totalSheets / totalHours : 0,
        shifts: yesterdayRows.map((r) => ({ shift: r.shiftName, value: r.sheetsPerOrderHour })),
      }
    }

    // Last week
    const lastWeekRows = machineRows.filter((r) => r.feedbackDate >= lastWeekStart && r.feedbackDate < thisWeekStart)
    let lastWeek: number | null = null
    if (lastWeekRows.length > 0) {
      const totalSheets = lastWeekRows.reduce((s, r) => s + r.totalSheetsFed, 0)
      const totalHours = lastWeekRows.reduce((s, r) => s + r.totalOrderHours, 0)
      lastWeek = totalHours > 0 ? totalSheets / totalHours : 0
    }

    // MTD
    const mtdRows = machineRows.filter((r) => r.feedbackDate >= monthStart)
    let mtd: number | null = null
    if (mtdRows.length > 0) {
      const totalSheets = mtdRows.reduce((s, r) => s + r.totalSheetsFed, 0)
      const totalHours = mtdRows.reduce((s, r) => s + r.totalOrderHours, 0)
      mtd = totalHours > 0 ? totalSheets / totalHours : 0
    }

    return { currentShift, todayShifts, yesterday: yesterdayData, lastWeek, mtd }
  }

  const machines: MachineStats[] = MACHINES.map((m) => {
    const machineRows = rows.filter((r) => r.lineNumber === m)
    return {
      lineNumber: m,
      lineName: machineNames[m] || String(m),
      ...calcForMachine(machineRows),
    }
  })

  // Plant total: sum each machine's sheets/hour (not weighted average)
  const plantCurrentShiftValues = machines.filter((m) => m.currentShift !== null)
  const plantCurrentShift = plantCurrentShiftValues.length > 0
    ? {
        value: plantCurrentShiftValues.reduce((s, m) => s + m.currentShift!.value, 0),
        shift: plantCurrentShiftValues[0].currentShift!.shift,
        orderHours: plantCurrentShiftValues.reduce((s, m) => s + m.currentShift!.orderHours, 0),
        sheetsFed: plantCurrentShiftValues.reduce((s, m) => s + m.currentShift!.sheetsFed, 0),
      }
    : null

  const plantYesterdayValues = machines.filter((m) => m.yesterday !== null)
  const plantYesterday = plantYesterdayValues.length > 0
    ? { value: plantYesterdayValues.reduce((s, m) => s + m.yesterday!.value, 0), shifts: [] as Array<{ shift: string; value: number }> }
    : null

  const plantLastWeekValues = machines.filter((m) => m.lastWeek !== null)
  const plantLastWeek = plantLastWeekValues.length > 0
    ? plantLastWeekValues.reduce((s, m) => s + m.lastWeek!, 0)
    : null

  const plantMtdValues = machines.filter((m) => m.mtd !== null)
  const plantMtd = plantMtdValues.length > 0
    ? plantMtdValues.reduce((s, m) => s + m.mtd!, 0)
    : null

  // Plant today shifts: sum each shift across machines
  const plantShiftMap = new Map<string, number>()
  for (const m of machines) {
    for (const s of m.todayShifts) {
      plantShiftMap.set(s.shift, (plantShiftMap.get(s.shift) ?? 0) + s.value)
    }
  }
  const plantTodayShifts: ShiftValue[] = Array.from(plantShiftMap.entries()).map(([shift, value]) => ({ shift, value }))

  const plant: MachineStats = {
    lineNumber: 0,
    lineName: "Plant Total",
    currentShift: plantCurrentShift,
    todayShifts: plantTodayShifts,
    yesterday: plantYesterday,
    lastWeek: plantLastWeek,
    mtd: plantMtd,
  }

  return { machines, plant }
}

// ── Stat Card ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  goal100,
  goal85,
  shifts,
}: {
  label: string
  value: number | null
  goal100: number
  goal85: number
  shifts?: Array<{ shift: string; value: number }>
}) {
  if (value === null) {
    return (
      <div className="tv-stat-card">
        <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider">{label}</div>
        <div className="text-base font-mono text-white/20">—</div>
      </div>
    )
  }

  const color = getStatusColor(value, goal100, goal85)

  return (
    <div className="tv-stat-card">
      <div className="text-[10px] font-medium text-white/40 uppercase tracking-wider">{label}</div>
      <div className="text-base font-mono font-bold tabular-nums leading-tight" style={{ color }}>
        {formatNumber(value)}
      </div>
      {shifts && shifts.length > 1 && (
        <div className="flex gap-2 mt-0.5">
          {shifts.map((s) => (
            <span
              key={s.shift}
              className="text-[10px] font-mono tabular-nums"
              style={{ color: getStatusColor(s.value, goal100, goal85) }}
            >
              {s.shift}: {formatNumber(s.value)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shift Scoreboard ─────────────────────────────────────────────────

function ShiftScoreboard({
  shifts,
  goal100,
  goal85,
}: {
  shifts: ShiftValue[]
  goal100: number
  goal85: number
}) {
  if (shifts.length < 2) return null

  const maxVal = Math.max(...shifts.map((s) => s.value), goal100)
  const leader = shifts.reduce((a, b) => (a.value >= b.value ? a : b))

  return (
    <div className="px-3 shrink-0 space-y-1">
      <div className="text-[10px] font-medium text-white/30 uppercase tracking-wider text-center">Today by Shift</div>
      {shifts.map((s) => {
        const pct = maxVal > 0 ? (s.value / maxVal) * 100 : 0
        const goalPct = maxVal > 0 ? (goal100 / maxVal) * 100 : 0
        const color = getStatusColor(s.value, goal100, goal85)
        const isLeader = s.shift === leader.shift && shifts.filter((x) => x.value === leader.value).length === 1

        return (
          <div key={s.shift} className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-white/50 w-12 text-right shrink-0 truncate">
              {s.shift}
            </span>
            <div className="flex-1 h-3.5 rounded-sm bg-white/5 relative overflow-hidden">
              <div
                className="h-full rounded-sm transition-all"
                style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${color}30` }}
              />
              {/* Goal marker */}
              <div
                className="absolute top-0 bottom-0 w-px bg-white/30"
                style={{ left: `${goalPct}%` }}
              />
            </div>
            <span
              className="text-[11px] font-mono font-bold tabular-nums w-12 text-right shrink-0"
              style={{ color }}
            >
              {formatNumber(s.value)}
            </span>
            {isLeader && (
              <span className="text-[10px] shrink-0" title="Shift leader">👑</span>
            )}
            {!isLeader && <span className="w-[18px] shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

// ── Machine Card ──────────────────────────────────────────────────────

function MachineCard({
  stats,
  goal,
  isPlant,
}: {
  stats: MachineStats
  goal: { pct85: number; pct90: number; pct100: number; pct112: number }
  isPlant?: boolean
}) {
  const currentValue = stats.currentShift?.value ?? 0
  const hasData = stats.currentShift !== null || stats.yesterday !== null || stats.lastWeek !== null || stats.mtd !== null
  const statusColor = stats.currentShift ? getStatusColor(currentValue, goal.pct100, goal.pct85) : "rgba(255,255,255,0.2)"
  const statusText = stats.currentShift ? getStatusLabel(currentValue, goal.pct100, goal.pct85) : "No Data"

  return (
    <div className={cn("tv-machine-card flex flex-col min-h-0", isPlant && "tv-machine-card-plant")}>
      {/* Header */}
      <div className="px-3 pt-2 pb-0.5 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white leading-tight">
            #{stats.lineNumber > 0 ? stats.lineNumber : ""} {stats.lineName}
          </h3>
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: `${statusColor}20`,
              color: statusColor,
            }}
          >
            {statusText}
          </span>
        </div>
      </div>

      {/* Gauge + Current Value */}
      <div className="flex flex-col items-center px-2 flex-1 justify-center min-h-0">
        <div className="tv-gauge-wrap">
          <Gauge
            value={currentValue}
            maxValue={goal.pct112 * 1.1}
            goal85={goal.pct85}
            goal100={goal.pct100}
            size={160}
          />
        </div>
        <div className="-mt-1 text-center shrink-0">
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: statusColor }}>
            {stats.currentShift ? formatNumber(currentValue) : "—"}
          </div>
          <div className="text-[11px] text-white/40 mt-0.5">
            {stats.currentShift ? `${stats.currentShift.shift} shift` : "Current Shift"} · Goal: {formatNumber(goal.pct100)}
          </div>
          {stats.currentShift && (
            <div className="flex gap-3 mt-1 text-[10px] font-mono text-white/35 tabular-nums">
              <span>{formatNumber(stats.currentShift.sheetsFed)} sheets</span>
              <span>{stats.currentShift.orderHours.toFixed(1)} hrs</span>
            </div>
          )}
        </div>
      </div>

      {/* Shift Scoreboard */}
      {stats.todayShifts.length >= 2 && (
        <ShiftScoreboard shifts={stats.todayShifts} goal100={goal.pct100} goal85={goal.pct85} />
      )}

      {/* Goal Reference */}
      <div className="flex justify-center gap-3 px-2 py-1 text-[10px] text-white/30 shrink-0">
        <span>85%: {formatNumber(goal.pct85)}</span>
        <span>90%: {formatNumber(goal.pct90)}</span>
        <span className="text-white/50 font-medium">100%: {formatNumber(goal.pct100)}</span>
        <span>112%: {formatNumber(goal.pct112)}</span>
      </div>

      {/* Time Period Stats */}
      {hasData && (
        <div className="grid grid-cols-3 gap-1.5 px-2 pb-2 shrink-0">
          <StatCard
            label="Yesterday"
            value={stats.yesterday?.value ?? null}
            goal100={goal.pct100}
            goal85={goal.pct85}
            shifts={stats.yesterday?.shifts}
          />
          <StatCard
            label="Last Week"
            value={stats.lastWeek}
            goal100={goal.pct100}
            goal85={goal.pct85}
          />
          <StatCard
            label="MTD"
            value={stats.mtd}
            goal100={goal.pct100}
            goal85={goal.pct85}
          />
        </div>
      )}
    </div>
  )
}

// ── Goals Editor Dialog ───────────────────────────────────────────────

function GoalsEditor({
  open,
  onClose,
  goals,
}: {
  open: boolean
  onClose: () => void
  goals: TvGoal[]
}) {
  const updateGoals = useUpdateTvGoals()
  const [editValues, setEditValues] = useState<Record<number, string>>({})

  useEffect(() => {
    const goalsMap = buildGoalsMap(goals)
    const values: Record<number, string> = {}
    for (const m of MACHINES) {
      values[m] = String(goalsMap[m].pct100)
    }
    setEditValues(values)
  }, [goals])

  const calcTiers = (pct100: number) => ({
    pct85: Math.round(pct100 * 0.85),
    pct90: Math.round(pct100 * 0.90),
    pct100: Math.round(pct100),
    pct112: Math.round(pct100 * 1.12),
  })

  const handleSave = () => {
    const goalsArray = MACHINES.map((m) => ({
      machine: m,
      ...calcTiers(parseFloat(editValues[m] || "0")),
    }))
    updateGoals.mutate(goalsArray, { onSuccess: () => onClose() })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Incentive Goals (Sheets/Order Hour)</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 px-3 text-left font-medium text-foreground-secondary">Machine</th>
                <th className="py-2 px-3 text-center font-medium text-foreground-secondary">85%</th>
                <th className="py-2 px-3 text-center font-medium text-foreground-secondary">90%</th>
                <th className="py-2 px-3 text-center font-medium text-foreground-secondary">100%</th>
                <th className="py-2 px-3 text-center font-medium text-foreground-secondary">112%</th>
              </tr>
            </thead>
            <tbody>
              {MACHINES.map((m) => {
                const tiers = calcTiers(parseFloat(editValues[m] || "0"))
                return (
                  <tr key={m} className="border-b border-border/50">
                    <td className="py-2 px-3 font-medium">{m}</td>
                    <td className="py-2 px-2 text-center text-foreground-secondary tabular-nums">{formatNumber(tiers.pct85)}</td>
                    <td className="py-2 px-2 text-center text-foreground-secondary tabular-nums">{formatNumber(tiers.pct90)}</td>
                    <td className="py-1 px-2">
                      <Input
                        type="number"
                        className="h-8 text-center text-sm font-semibold [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
                        value={editValues[m] || ""}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, [m]: e.target.value }))}
                      />
                    </td>
                    <td className="py-2 px-2 text-center text-foreground-secondary tabular-nums">{formatNumber(tiers.pct112)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateGoals.isPending}>
            {updateGoals.isPending ? "Saving..." : "Save Goals"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main Component ────────────────────────────────────────────────────

export default function PlantTvDashboard() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showGoals, setShowGoals] = useState(false)
  const { roles } = useAuth()
  const isAdmin = roles.map(r => String(r)).includes("ADMIN")
  const { startDate, endDate } = useMemo(getDateRange, [])

  const { data: tvData, isLoading, dataUpdatedAt, refetch } = useTvData(startDate, endDate)
  const { data: goalsData } = useTvGoals()

  const goals = useMemo(() => buildGoalsMap(goalsData?.goals || []), [goalsData])

  const plantGoals = useMemo(() => {
    let p85 = 0, p90 = 0, p100 = 0, p112 = 0
    for (const m of MACHINES) {
      const g = goals[m] || DEFAULT_GOALS[m]
      p85 += g.pct85; p90 += g.pct90; p100 += g.pct100; p112 += g.pct112
    }
    return { pct85: p85, pct90: p90, pct100: p100, pct112: p112 }
  }, [goals])

  const { machines, plant } = useMemo(
    () => aggregateStats(tvData?.rows || []),
    [tvData]
  )

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  const lastRefreshed = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null

  return (
    <div className={cn(
      "tv-dashboard flex flex-col h-full",
      isFullscreen && "fixed inset-0 z-50"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-white/40" />
          <div>
            <h1 className="text-sm font-semibold text-white leading-tight">Plant TV — Sheets / Order Hour</h1>
            {lastRefreshed && (
              <p className="text-[10px] text-white/30 leading-tight">
                Last refreshed: {lastRefreshed} · Auto-refreshes every 5 min
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1 h-7 px-2 text-xs tv-btn">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setShowGoals(true)} className="gap-1 h-7 px-2 text-xs tv-btn">
              <Settings className="h-3.5 w-3.5" /> Goals
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={toggleFullscreen} className="gap-1 h-7 px-2 text-xs tv-btn">
            {isFullscreen ? <><Minimize className="h-3.5 w-3.5" /> Exit</> : <><Maximize className="h-3.5 w-3.5" /> Fullscreen</>}
          </Button>
        </div>
      </div>

      {/* Card Grid */}
      <div className="flex-1 overflow-hidden p-2 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-500" />
          </div>
        ) : (
          <div className="tv-grid gap-2 h-full">
            {/* Top row: 4 machines */}
            {machines.slice(0, 4).map((m) => (
              <MachineCard key={m.lineNumber} stats={m} goal={goals[m.lineNumber]} />
            ))}
            {/* Bottom row: 3 machines + plant */}
            {machines.slice(4).map((m) => (
              <MachineCard key={m.lineNumber} stats={m} goal={goals[m.lineNumber]} />
            ))}
            <MachineCard stats={plant} goal={plantGoals} isPlant />
          </div>
        )}
      </div>

      <GoalsEditor open={showGoals} onClose={() => setShowGoals(false)} goals={goalsData?.goals || []} />
    </div>
  )
}
