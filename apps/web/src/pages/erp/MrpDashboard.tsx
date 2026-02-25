import { useState, useMemo, useCallback, useRef, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts"
import { Card, CardContent } from "@/components/ui/card"
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
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowLeft,
  Info,
  ChevronUp,
  Search,
} from "lucide-react"
import {
  useMrpProjection,
  useMrpHealthSummary,
  useMrpSpecDetail,
  useMrpFilterOptions,
} from "@/api/hooks/useMrpDashboard"
import type {
  MrpGranularity,
  ValueMode,
  MrpSpec,
} from "@/api/hooks/useMrpDashboard"

// ── Persisted state ────────────────────────────────────────────

function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `mrp-dash:${key}`
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

// ── Helpers ────────────────────────────────────────────────────

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${formatNumber(value)}`
}

function healthCellClass(health: string): string {
  switch (health) {
    case "shortage": return "bg-red-500/15 text-red-700 dark:text-red-400"
    case "belowMin": return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
    case "good": return "bg-green-500/10"
    default: return ""
  }
}

// ── KPI Card ───────────────────────────────────────────────────

interface KpiCardProps {
  title: string
  value: string
  tooltip?: string
  alert?: boolean
}

function KpiCard({ title, value, tooltip, alert }: KpiCardProps) {
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
        <p className={`text-2xl font-bold mt-1 ${alert ? "text-red-500" : "text-foreground"}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

// ── Granularity selector ───────────────────────────────────────

const GRANULARITY_OPTIONS: { value: MrpGranularity; label: string }[] = [
  { value: "day", label: "D" },
  { value: "week", label: "W" },
  { value: "2week", label: "2W" },
  { value: "month", label: "M" },
]

// ── Filter pills ───────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: "shortage", label: "Shortage" },
  { value: "belowMin", label: "Below Min" },
  { value: "hasOrders", label: "Has Orders" },
  { value: "pastDue", label: "Past Dues" },
]

// ── Chart tooltip ──────────────────────────────────────────────

function ChartTooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border px-3 py-2 text-xs shadow-md" style={{ backgroundColor: "var(--color-bg-secondary)", color: "var(--color-text)" }}>
      <p className="font-medium mb-1">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{entry.name}: {formatNumber(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────

export default function MrpDashboard() {
  const navigate = useNavigate()

  // Persisted state
  const [granularity, setGranularity] = usePersistedState<MrpGranularity>("granularity", "week")
  const [horizon] = usePersistedState<number>("horizon", 12)
  const [valueMode, setValueMode] = usePersistedState<ValueMode>("valueMode", "qty")
  const [companyFilter, setCompanyFilter] = usePersistedState<string>("company", "all")
  const [specSearch, setSpecSearch] = usePersistedState<string>("specSearch", "")
  const [activeFilters, setActiveFilters] = usePersistedState<string[]>("filters", [])

  // Non-persisted
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // Debounced spec search
  const [debouncedSpec, setDebouncedSpec] = useState(specSearch)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSpec(specSearch), 300)
    return () => clearTimeout(debounceRef.current)
  }, [specSearch])

  // Data hooks
  const { data: filterOptions } = useMrpFilterOptions()
  const { data: projection, isLoading, isError } = useMrpProjection(granularity, horizon, companyFilter, debouncedSpec, activeFilters)
  const { data: healthData } = useMrpHealthSummary(granularity, horizon, companyFilter, debouncedSpec)
  const { data: specDetail, isLoading: detailLoading } = useMrpSpecDetail(selectedSpec)

  const companies = filterOptions?.companies ?? []

  // Toggle filter
  const toggleFilter = useCallback((f: string) => {
    setActiveFilters((prev) => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }, [setActiveFilters])

  // Top shortages for bar chart
  const topShortages = useMemo(() => {
    if (!projection?.specs) return []
    return projection.specs
      .filter(s => s.shortageDate !== null)
      .map(s => ({
        specNumber: s.specNumber,
        worstProjected: Math.min(...s.buckets.map(b => b.projected)),
      }))
      .sort((a, b) => a.worstProjected - b.worstProjected)
      .slice(0, 10)
  }, [projection])

  // Value display helper
  const displayValue = useCallback((qty: number, spec: MrpSpec): string => {
    switch (valueMode) {
      case "cost": return formatCurrency(qty * spec.unitCost)
      case "price": return formatCurrency(qty * spec.unitPrice)
      default: return formatNumber(qty)
    }
  }, [valueMode])

  // Detail panel mini chart data
  const miniChartData = useMemo(() => {
    if (!selectedSpec || !projection) return []
    const spec = projection.specs.find(s => s.specNumber === selectedSpec)
    if (!spec) return []
    return projection.bucketLabels.map((label, i) => ({
      label,
      projected: spec.buckets[i].projected,
      minQty: spec.minQty,
      maxQty: spec.maxQty,
    }))
  }, [selectedSpec, projection])

  const selectedSpecData = projection?.specs.find(s => s.specNumber === selectedSpec)

  return (
    <div className="flex flex-col gap-4 p-4 max-w-[1600px] mx-auto">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="h-8 w-8 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold text-foreground">MRP & Inventory</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Company filter */}
          <SearchableSelect
            value={companyFilter}
            onValueChange={setCompanyFilter}
            options={companies}
            placeholder="All Companies"
            searchPlaceholder="Search company..."
            width="w-[180px]"
          />

          {/* Spec search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search spec..."
              value={specSearch}
              onChange={(e) => setSpecSearch(e.target.value)}
              className="h-8 w-[180px] pl-7 text-xs"
            />
          </div>

          {/* Granularity toggle */}
          <div className="flex rounded-md border border-border overflow-hidden">
            {GRANULARITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGranularity(opt.value)}
                className={`px-3 py-1 text-xs font-medium transition-colors ${
                  granularity === opt.value
                    ? "bg-foreground text-background"
                    : "bg-background text-foreground hover:bg-background-hover"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Filter pills */}
          <div className="flex gap-1.5 ml-2">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f.value}
                onClick={() => toggleFilter(f.value)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                  activeFilters.includes(f.value)
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background text-foreground-secondary border-border hover:bg-background-hover"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Loading / Error ────────────────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground" />
        </div>
      )}

      {isError && (
        <div className="text-center py-20 text-red-500">
          Failed to load MRP data. Check that the Kiwiplan gateway is configured.
        </div>
      )}

      {projection && (
        <>
          {/* ── KPI Cards ──────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard title="Total SKUs" value={formatNumber(projection.kpis.totalSKUs)} />
            <KpiCard title="In Shortage" value={formatNumber(projection.kpis.inShortage)} alert={projection.kpis.inShortage > 0} />
            <KpiCard title="Below Min" value={formatNumber(projection.kpis.belowMin)} alert={projection.kpis.belowMin > 0} />
            <KpiCard title="On Hand $" value={formatCurrency(projection.kpis.onHandCost)} tooltip="Total on-hand inventory at cost" />
            <KpiCard title="+4W $" value={formatCurrency(projection.kpis.projected4wCost)} tooltip="Projected inventory value at cost in 4 weeks" />
            <KpiCard title="Past Dues" value={formatNumber(projection.kpis.pastDueCount)} alert={projection.kpis.pastDueCount > 0} />
          </div>

          {/* ── Charts Row ─────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Health Over Time (stacked area) */}
            <Card className="lg:col-span-2 bg-background-secondary">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">Inventory Health Over Time</p>
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={healthData?.data ?? []}>
                    <defs>
                      <linearGradient id="fillGood" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="fillAdequate" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="fillBelowMin" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="fillShortage" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} />
                    <RechartsTooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="good" stackId="health" stroke="#22c55e" fill="url(#fillGood)" name="Good" isAnimationActive={false} />
                    <Area type="monotone" dataKey="adequate" stackId="health" stroke="#6366f1" fill="url(#fillAdequate)" name="Adequate" isAnimationActive={false} />
                    <Area type="monotone" dataKey="belowMin" stackId="health" stroke="#f59e0b" fill="url(#fillBelowMin)" name="Below Min" isAnimationActive={false} />
                    <Area type="monotone" dataKey="shortage" stackId="health" stroke="#ef4444" fill="url(#fillShortage)" name="Shortage" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top Shortages (horizontal bar) */}
            <Card className="bg-background-secondary">
              <CardContent className="p-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">Top Shortages</p>
                <div className="max-h-[300px] overflow-y-auto">
                  {topShortages.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-8">No shortages projected</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(200, topShortages.length * 28)}>
                      <BarChart data={topShortages} layout="vertical" margin={{ left: 0, right: 10, top: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis type="number" tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} />
                        <YAxis
                          type="category"
                          dataKey="specNumber"
                          width={80}
                          tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }}
                        />
                        <RechartsTooltip content={<ChartTooltipContent />} />
                        <Bar
                          dataKey="worstProjected"
                          fill="#ef4444"
                          name="Worst Projected"
                          isAnimationActive={false}
                          cursor="pointer"
                          onClick={(_data, _index, e) => {
                            const payload = (e as unknown as { specNumber?: string })
                            if (payload.specNumber) {
                              setSelectedSpec(payload.specNumber)
                              setDetailOpen(true)
                            }
                          }}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Value Mode Toggle ──────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-medium">Display:</span>
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["qty", "cost", "price"] as ValueMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setValueMode(mode)}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    valueMode === mode
                      ? "bg-foreground text-background"
                      : "bg-background text-foreground hover:bg-background-hover"
                  }`}
                >
                  {mode === "qty" ? "Qty" : mode === "cost" ? "$ Cost" : "$ Price"}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground ml-4">
              {projection.specs.length} spec{projection.specs.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* ── Main MRP Table ─────────────────────────── */}
          <Card className="bg-background-secondary overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 bg-background-secondary min-w-[100px]">Spec</TableHead>
                    <TableHead className="sticky left-[100px] z-10 bg-background-secondary min-w-[120px]">Company</TableHead>
                    <TableHead className="sticky left-[220px] z-10 bg-background-secondary min-w-[100px]">Cust Spec</TableHead>
                    <TableHead className="text-right min-w-[70px]">On Hand</TableHead>
                    {projection.bucketLabels.map((label) => (
                      <TableHead key={label} className="text-right min-w-[70px] text-xs">
                        {label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projection.specs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4 + projection.bucketLabels.length} className="text-center py-8 text-muted-foreground">
                        No specs match the current filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    projection.specs.map((spec) => (
                      <TableRow
                        key={spec.specNumber}
                        className={`cursor-pointer hover:bg-background-hover transition-colors ${selectedSpec === spec.specNumber ? "bg-background-selected" : ""}`}
                        onClick={() => {
                          setSelectedSpec(selectedSpec === spec.specNumber ? null : spec.specNumber)
                          setDetailOpen(true)
                        }}
                      >
                        <TableCell className="sticky left-0 z-10 bg-background-secondary font-mono text-xs font-medium">
                          {spec.specNumber}
                        </TableCell>
                        <TableCell className="sticky left-[100px] z-10 bg-background-secondary text-xs truncate max-w-[120px]">
                          {spec.companyName}
                        </TableCell>
                        <TableCell className="sticky left-[220px] z-10 bg-background-secondary text-xs truncate max-w-[100px]">
                          {spec.customerSpec}
                        </TableCell>
                        <TableCell className="text-right text-xs font-mono">
                          {displayValue(spec.onHand, spec)}
                        </TableCell>
                        {spec.buckets.map((bucket, idx) => (
                          <TableCell
                            key={idx}
                            className={`text-right text-xs font-mono ${healthCellClass(bucket.health)}`}
                          >
                            {displayValue(bucket.projected, spec)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* ── Detail Panel ───────────────────────────── */}
          {selectedSpec && detailOpen && (
            <Card className="bg-background-secondary">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-foreground">
                    Detail: {selectedSpec}
                    {selectedSpecData && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        — {selectedSpecData.companyName}
                      </span>
                    )}
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setDetailOpen(false); setSelectedSpec(null) }}
                    className="h-7 w-7 p-0"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </div>

                {/* Mini projection chart */}
                {miniChartData.length > 0 && selectedSpecData && (
                  <div className="mb-4">
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={miniChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} />
                        <YAxis tick={{ fontSize: 10, fill: "var(--color-text-secondary)" }} />
                        <RechartsTooltip content={<ChartTooltipContent />} />
                        {selectedSpecData.maxQty > 0 && (
                          <ReferenceArea
                            y1={selectedSpecData.minQty}
                            y2={selectedSpecData.maxQty}
                            fill="#6366f1"
                            fillOpacity={0.08}
                          />
                        )}
                        <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="3 3" />
                        <Line
                          type="monotone"
                          dataKey="projected"
                          stroke="#6366f1"
                          strokeWidth={2}
                          dot={false}
                          name="Projected Qty"
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {/* Detail tables */}
                {detailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
                  </div>
                ) : specDetail ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Open MOs */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        Open MOs ({specDetail.openMOs.length})
                      </p>
                      <div className="max-h-[250px] overflow-y-auto border border-border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Job #</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs">Due</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {specDetail.openMOs.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-4">None</TableCell>
                              </TableRow>
                            ) : specDetail.openMOs.map((mo, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{mo.jobNum}</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(mo.remainingQty)}</TableCell>
                                <TableCell className="text-xs">{mo.dueDate}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Call Offs */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        Open Call Offs ({specDetail.callOffs.length})
                      </p>
                      <div className="max-h-[250px] overflow-y-auto border border-border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Job #</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs">Due</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {specDetail.callOffs.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-4">None</TableCell>
                              </TableRow>
                            ) : specDetail.callOffs.map((co, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{co.jobNum}</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(co.remainingQty)}</TableCell>
                                <TableCell className="text-xs">{co.dueDate}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                    {/* Ship Log */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">
                        Ship Log ({specDetail.shipLog.length})
                      </p>
                      <div className="max-h-[250px] overflow-y-auto border border-border rounded">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Date</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs">Company</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {specDetail.shipLog.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={3} className="text-xs text-center text-muted-foreground py-4">None</TableCell>
                              </TableRow>
                            ) : specDetail.shipLog.map((entry, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs">{entry.shipDate}</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(entry.qty)}</TableCell>
                                <TableCell className="text-xs truncate max-w-[120px]">{entry.companyName}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
