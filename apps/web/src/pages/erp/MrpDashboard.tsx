import { useState, useMemo, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Card, CardContent } from "@/components/ui/card"
import { SearchableSelect } from "@/components/ui/searchable-select"
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
  ChevronUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react"
import {
  useMrpProjection,
  useMrpSpecDetail,
  useMrpFilterOptions,
} from "@/api/hooks/useMrpDashboard"
import type { MrpGranularity, MrpSpec } from "@/api/hooks/useMrpDashboard"

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

function formatMoS(value: number | null): string {
  if (value === null || value === undefined) return "—"
  return formatNumber(value, 1)
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return `${+m}/${+d}/${y.slice(2)}`
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

// ── Sort types ─────────────────────────────────────────────────

type SortKey =
  | "specNumber"
  | "companyName"
  | "customerSpec"
  | "minQty"
  | "minMonthsOfSupply"
  | "maxQty"
  | "maxMonthsOfSupply"
  | "onHand"
  | "onHandMonthsOfSupply"
  | "last30DayUsage"
  | "avg30DayUsage90"
  | "belowMinDate"

type SortDir = "asc" | "desc"

function getSortValue(spec: MrpSpec, key: SortKey): number | string {
  const v = spec[key]
  if (v === null || v === undefined) {
    if (key.includes("Months")) return Infinity
    if (key.includes("Date")) return "\uffff" // sort nulls last
    return ""
  }
  return v
}

// ── Constants ──────────────────────────────────────────────────

const WEEKLY_OFFSETS = [0, 1, 2, 3, 4, 6, 8, 10]

// ── Conditional formatting ─────────────────────────────────────

function onHandCellClass(spec: MrpSpec): string {
  if (spec.onHand <= 0) return "bg-red-500/15 text-red-700 dark:text-red-400"
  if (spec.onHand < spec.minQty) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
  return ""
}

function ohMosCellClass(spec: MrpSpec): string {
  if (spec.onHandMonthsOfSupply === null) return ""
  if (spec.onHandMonthsOfSupply < 1) return "bg-red-500/15 text-red-700 dark:text-red-400"
  if (spec.minMonthsOfSupply !== null && spec.onHandMonthsOfSupply < spec.minMonthsOfSupply) {
    return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
  }
  return ""
}

function healthCellClass(health: string): string {
  switch (health) {
    case "shortage": return "bg-red-500/15 text-red-700 dark:text-red-400"
    case "belowMin": return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400"
    case "good": return "bg-green-500/10"
    default: return ""
  }
}

// ── Main Component ─────────────────────────────────────────────

type ActiveTab = "usage" | "mrp" | "value"
type ValueBasis = "cost" | "price"

export default function MrpDashboard() {
  const navigate = useNavigate()

  // Persisted state
  const [activeTab, setActiveTab] = usePersistedState<ActiveTab>("tab", "usage")
  const [mrpGranularity, setMrpGranularity] = usePersistedState<"week" | "day">("mrpGran", "week")
  const [valueBasis, setValueBasis] = usePersistedState<ValueBasis>("valueBasis", "cost")
  const [companyFilter, setCompanyFilter] = usePersistedState<string>("company", "all")
  const [specFilter, setSpecFilter] = usePersistedState<string>("specFilter", "all")
  const [activeFilters, setActiveFilters] = usePersistedState<string[]>("filters", [])
  const [hasOrdersFilter, setHasOrdersFilter] = usePersistedState<string>("hasOrders", "all")
  const [hasMinOrMaxFilter, setHasMinOrMaxFilter] = usePersistedState<string>("hasMinOrMax", "all")
  const [sortKey, setSortKey] = usePersistedState<SortKey>("sortKey", "maxMonthsOfSupply")
  const [sortDir, setSortDir] = usePersistedState<SortDir>("sortDir", "asc")

  // Non-persisted
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // API params differ by tab
  const needsBuckets = activeTab === "mrp" || activeTab === "value"
  const apiGranularity: MrpGranularity = needsBuckets ? mrpGranularity : "week"
  const apiHorizon = needsBuckets && mrpGranularity === "day" ? 14 : 12

  // Data hooks
  const { data: filterOptions } = useMrpFilterOptions()
  const { data: projection, isLoading, isError, error: projectionError } = useMrpProjection(
    apiGranularity, apiHorizon, companyFilter, specFilter === "all" ? "" : specFilter, activeFilters, hasOrdersFilter, hasMinOrMaxFilter
  )
  const { data: specDetail, isLoading: detailLoading } = useMrpSpecDetail(selectedSpec)

  const companies = filterOptions?.companies ?? []
  const specOptions = filterOptions?.specs ?? []

  // Toggle filter pill
  const toggleFilter = useCallback((f: string) => {
    setActiveFilters((prev) => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }, [setActiveFilters])

  // Sort handler
  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => d === "asc" ? "desc" : "asc")
        return prev
      }
      setSortDir("asc")
      return key
    })
  }, [setSortKey, setSortDir])

  // Sorted specs
  const sortedSpecs = useMemo(() => {
    if (!projection?.specs) return []
    return [...projection.specs].sort((a, b) => {
      const va = getSortValue(a, sortKey)
      const vb = getSortValue(b, sortKey)
      let cmp = 0
      if (typeof va === "string" && typeof vb === "string") {
        cmp = va.localeCompare(vb)
      } else {
        cmp = (va as number) - (vb as number)
      }
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [projection?.specs, sortKey, sortDir])

  // MRP/Value tab: which bucket indices to display
  const mrpBucketIndices = useMemo(() => {
    if (!projection || !needsBuckets) return []
    const h = apiHorizon
    if (mrpGranularity === "week") {
      return WEEKLY_OFFSETS.map(o => h + o).filter(i => i < projection.bucketLabels.length)
    }
    // Daily: show 0 through +horizon
    return Array.from({ length: h + 1 }, (_, i) => h + i).filter(i => i < projection.bucketLabels.length)
  }, [projection, needsBuckets, mrpGranularity, apiHorizon])

  // MRP tab: bucket column totals
  const mrpBucketTotals = useMemo(() => {
    if (mrpBucketIndices.length === 0) return []
    return mrpBucketIndices.map(idx =>
      sortedSpecs.reduce((sum, spec) => sum + (spec.buckets[idx]?.projected ?? 0), 0)
    )
  }, [sortedSpecs, mrpBucketIndices])

  // Value tab: bucket column totals (projected * unit rate)
  const valueBucketTotals = useMemo(() => {
    if (mrpBucketIndices.length === 0) return []
    return mrpBucketIndices.map(idx =>
      sortedSpecs.reduce((sum, spec) => {
        const rate = valueBasis === "cost" ? spec.unitCost : spec.unitPrice
        return sum + (spec.buckets[idx]?.projected ?? 0) * rate
      }, 0)
    )
  }, [sortedSpecs, mrpBucketIndices, valueBasis])

  const selectedSpecData = projection?.specs.find(s => s.specNumber === selectedSpec)

  // Sort icon helper
  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />
  }

  // Row click handler
  const handleRowClick = useCallback((specNumber: string) => {
    setSelectedSpec(prev => prev === specNumber ? null : specNumber)
    setDetailOpen(true)
  }, [])

  // (removed custom tabBtnClass — using shadcn Button variant instead)

  return (
    <div className="flex-1 overflow-y-auto px-6 pb-6 -mx-6 -mt-6 pt-3 space-y-4">
      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center gap-3 pb-2 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">MRP & Inventory</span>

        {/* Tab toggle */}
        <div className="flex items-center gap-1 ml-2">
          <Button variant={activeTab === "usage" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setActiveTab("usage")}>Usage</Button>
          <Button variant={activeTab === "mrp" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setActiveTab("mrp")}>MRP</Button>
          <Button variant={activeTab === "value" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setActiveTab("value")}>Inv Value</Button>
        </div>

        {/* Granularity toggle (MRP/Value tabs) */}
        {needsBuckets && (
          <div className="flex items-center gap-1">
            <Button variant={mrpGranularity === "week" ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" onClick={() => setMrpGranularity("week")}>W</Button>
            <Button variant={mrpGranularity === "day" ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" onClick={() => setMrpGranularity("day")}>D</Button>
          </div>
        )}

        {/* Cost/Price toggle (Value tab only) */}
        {activeTab === "value" && (
          <div className="flex items-center gap-1">
            <Button variant={valueBasis === "cost" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setValueBasis("cost")}>Cost</Button>
            <Button variant={valueBasis === "price" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setValueBasis("price")}>Price</Button>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SearchableSelect
            value={companyFilter}
            onValueChange={setCompanyFilter}
            options={companies}
            placeholder="All Companies"
            searchPlaceholder="Search company..."
            width="w-[180px]"
          />
          <SearchableSelect
            value={specFilter}
            onValueChange={setSpecFilter}
            options={specOptions}
            placeholder="All Specs"
            searchPlaceholder="Search spec..."
            width="w-[180px]"
          />
          <Select value={hasOrdersFilter} onValueChange={setHasOrdersFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Has Demand/MOs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Demand/MOs: All</SelectItem>
              <SelectItem value="true">Has Demand/MOs</SelectItem>
              <SelectItem value="false">No Demand/MOs</SelectItem>
            </SelectContent>
          </Select>
          <Select value={hasMinOrMaxFilter} onValueChange={setHasMinOrMaxFilter}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder="Has Min/Max" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Min/Max: All</SelectItem>
              <SelectItem value="true">Has Min/Max</SelectItem>
              <SelectItem value="false">No Min/Max</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1">
            {[
              { value: "shortage", label: "Shortage" },
              { value: "belowMin", label: "Below Min" },
            ].map((f) => (
              <Button
                key={f.value}
                variant={activeFilters.includes(f.value) ? "default" : "outline"}
                size="sm"
                className="h-7 px-2.5 text-xs"
                onClick={() => toggleFilter(f.value)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {projection && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {projection.specs.length} spec{projection.specs.length !== 1 ? "s" : ""}
            </span>
          )}
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
          <p>Failed to load MRP data.</p>
          {projectionError && <p className="text-xs mt-2 text-muted-foreground">{String(projectionError)}</p>}
        </div>
      )}

      {projection && (
        <>
          {/* ════════════════ USAGE TAB ════════════════ */}
          {activeTab === "usage" && (
            <Card className="bg-background-secondary overflow-hidden">
              <div className="overflow-auto max-h-[416px]">
                <Table className="[&_td]:py-1 [&_td]:px-2 [&_th]:py-1.5 [&_th]:px-2">
                  <TableHeader className="sticky top-0 z-20 bg-background-secondary">
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-background-secondary min-w-[100px] cursor-pointer select-none" onClick={() => handleSort("specNumber")}>
                        <span className="inline-flex items-center text-xs">Spec<SortIcon column="specNumber" /></span>
                      </TableHead>
                      <TableHead className="sticky left-[100px] z-10 bg-background-secondary min-w-[120px] cursor-pointer select-none" onClick={() => handleSort("companyName")}>
                        <span className="inline-flex items-center text-xs">Company<SortIcon column="companyName" /></span>
                      </TableHead>
                      <TableHead className="min-w-[100px] cursor-pointer select-none" onClick={() => handleSort("customerSpec")}>
                        <span className="inline-flex items-center text-xs">Cust Spec<SortIcon column="customerSpec" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[70px] cursor-pointer select-none" onClick={() => handleSort("minQty")}>
                        <span className="inline-flex items-center justify-end text-xs">Min Qty<SortIcon column="minQty" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[65px] cursor-pointer select-none" onClick={() => handleSort("minMonthsOfSupply")}>
                        <span className="inline-flex items-center justify-end text-xs">Min MoS<SortIcon column="minMonthsOfSupply" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[70px] cursor-pointer select-none" onClick={() => handleSort("maxQty")}>
                        <span className="inline-flex items-center justify-end text-xs">Max Qty<SortIcon column="maxQty" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[65px] cursor-pointer select-none" onClick={() => handleSort("maxMonthsOfSupply")}>
                        <span className="inline-flex items-center justify-end text-xs">Max MoS<SortIcon column="maxMonthsOfSupply" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[75px] cursor-pointer select-none" onClick={() => handleSort("onHand")}>
                        <span className="inline-flex items-center justify-end text-xs">On Hand<SortIcon column="onHand" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[65px] cursor-pointer select-none" onClick={() => handleSort("onHandMonthsOfSupply")}>
                        <span className="inline-flex items-center justify-end text-xs">OH MoS<SortIcon column="onHandMonthsOfSupply" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[70px] cursor-pointer select-none" onClick={() => handleSort("last30DayUsage")}>
                        <span className="inline-flex items-center justify-end text-xs">Last 30d<SortIcon column="last30DayUsage" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[70px] cursor-pointer select-none" onClick={() => handleSort("avg30DayUsage90")}>
                        <span className="inline-flex items-center justify-end text-xs">Avg 30d<SortIcon column="avg30DayUsage90" /></span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSpecs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No specs match the current filters</TableCell>
                      </TableRow>
                    ) : (
                      sortedSpecs.map((spec) => (
                        <TableRow key={spec.specNumber} className={`cursor-pointer hover:bg-background-hover transition-colors ${selectedSpec === spec.specNumber ? "bg-background-selected" : ""}`} onClick={() => handleRowClick(spec.specNumber)}>
                          <TableCell className="sticky left-0 z-10 bg-background-secondary font-mono text-xs font-medium">{spec.specNumber}</TableCell>
                          <TableCell className="sticky left-[100px] z-10 bg-background-secondary text-xs truncate max-w-[120px]">{spec.companyName}</TableCell>
                          <TableCell className="text-xs truncate max-w-[100px]">{spec.customerSpec}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(spec.minQty)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatMoS(spec.minMonthsOfSupply)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(spec.maxQty)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatMoS(spec.maxMonthsOfSupply)}</TableCell>
                          <TableCell className={`text-right text-xs font-mono ${onHandCellClass(spec)}`}>{formatNumber(spec.onHand)}</TableCell>
                          <TableCell className={`text-right text-xs font-mono ${ohMosCellClass(spec)}`}>{formatMoS(spec.onHandMonthsOfSupply)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(spec.last30DayUsage)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatMoS(spec.avg30DayUsage90)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <tfoot className="sticky bottom-0 z-20 bg-black text-white">
                    <TableRow className="font-semibold hover:bg-black">
                      <TableCell className="sticky left-0 z-10 bg-black text-xs">Totals</TableCell>
                      <TableCell className="sticky left-[100px] z-10 bg-black text-xs" />
                      <TableCell className="text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalMinQty)}</TableCell>
                      <TableCell className="text-right text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalMaxQty)}</TableCell>
                      <TableCell className="text-right text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalOnHand)}</TableCell>
                      <TableCell className="text-right text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalLast30d)}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalAvg30d, 1)}</TableCell>
                    </TableRow>
                  </tfoot>
                </Table>
              </div>
            </Card>
          )}

          {/* ════════════════ MRP TAB ════════════════ */}
          {activeTab === "mrp" && (
            <Card className="bg-background-secondary overflow-hidden">
              <div className="overflow-auto max-h-[416px]">
                <Table className="w-max min-w-full [&_td]:py-1 [&_td]:px-2 [&_th]:py-1.5 [&_th]:px-2">
                  <TableHeader className="sticky top-0 z-20 bg-background-secondary">
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-background-secondary min-w-[100px] cursor-pointer select-none" onClick={() => handleSort("specNumber")}>
                        <span className="inline-flex items-center text-xs">Spec<SortIcon column="specNumber" /></span>
                      </TableHead>
                      <TableHead className="sticky left-[100px] z-10 bg-background-secondary min-w-[120px] cursor-pointer select-none" onClick={() => handleSort("companyName")}>
                        <span className="inline-flex items-center text-xs">Company<SortIcon column="companyName" /></span>
                      </TableHead>
                      <TableHead className="min-w-[100px] cursor-pointer select-none" onClick={() => handleSort("customerSpec")}>
                        <span className="inline-flex items-center text-xs">Cust Spec<SortIcon column="customerSpec" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[85px] cursor-pointer select-none" onClick={() => handleSort("belowMinDate")}>
                        <span className="inline-flex items-center justify-end text-xs">Below Min<SortIcon column="belowMinDate" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[70px] cursor-pointer select-none" onClick={() => handleSort("minQty")}>
                        <span className="inline-flex items-center justify-end text-xs">Min Qty<SortIcon column="minQty" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[70px] cursor-pointer select-none" onClick={() => handleSort("maxQty")}>
                        <span className="inline-flex items-center justify-end text-xs">Max Qty<SortIcon column="maxQty" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[75px] cursor-pointer select-none" onClick={() => handleSort("onHand")}>
                        <span className="inline-flex items-center justify-end text-xs">OnHand<SortIcon column="onHand" /></span>
                      </TableHead>
                      {mrpBucketIndices.map((idx) => (
                        <TableHead key={idx} className="text-right min-w-[80px]">
                          <span className="text-xs">{projection.bucketDates[idx] ? formatShortDate(projection.bucketDates[idx]) : ""}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSpecs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7 + mrpBucketIndices.length} className="text-center py-8 text-muted-foreground">No specs match the current filters</TableCell>
                      </TableRow>
                    ) : (
                      sortedSpecs.map((spec) => (
                        <TableRow key={spec.specNumber} className={`cursor-pointer hover:bg-background-hover transition-colors ${selectedSpec === spec.specNumber ? "bg-background-selected" : ""}`} onClick={() => handleRowClick(spec.specNumber)}>
                          <TableCell className="sticky left-0 z-10 bg-background-secondary font-mono text-xs font-medium">{spec.specNumber}</TableCell>
                          <TableCell className="sticky left-[100px] z-10 bg-background-secondary text-xs truncate max-w-[120px]">{spec.companyName}</TableCell>
                          <TableCell className="text-xs truncate max-w-[100px]">{spec.customerSpec}</TableCell>
                          <TableCell className="text-right text-xs">{spec.belowMinDate ? formatShortDate(spec.belowMinDate) : ""}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(spec.minQty)}</TableCell>
                          <TableCell className="text-right text-xs font-mono">{formatNumber(spec.maxQty)}</TableCell>
                          <TableCell className={`text-right text-xs font-mono ${onHandCellClass(spec)}`}>{formatNumber(spec.onHand)}</TableCell>
                          {mrpBucketIndices.map((idx) => {
                            const bucket = spec.buckets[idx]
                            if (!bucket) return <TableCell key={idx} />
                            return (
                              <TableCell key={idx} className={`text-right text-xs font-mono ${healthCellClass(bucket.health)}`}>
                                {formatNumber(bucket.projected)}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                  <tfoot className="sticky bottom-0 z-20 bg-black text-white">
                    <TableRow className="font-semibold hover:bg-black">
                      <TableCell className="sticky left-0 z-10 bg-black text-xs">Total</TableCell>
                      <TableCell className="sticky left-[100px] z-10 bg-black text-xs" />
                      <TableCell className="text-xs" />
                      <TableCell className="text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalMinQty)}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalMaxQty)}</TableCell>
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalOnHand)}</TableCell>
                      {mrpBucketTotals.map((total, i) => (
                        <TableCell key={i} className="text-right text-xs font-mono">{formatNumber(total)}</TableCell>
                      ))}
                    </TableRow>
                  </tfoot>
                </Table>
              </div>
            </Card>
          )}

          {/* ════════════════ INV VALUE TAB ════════════════ */}
          {activeTab === "value" && (
            <Card className="bg-background-secondary overflow-hidden">
              <div className="overflow-auto max-h-[416px]">
                <Table className="w-max min-w-full [&_td]:py-1 [&_td]:px-2 [&_th]:py-1.5 [&_th]:px-2">
                  <TableHeader className="sticky top-0 z-20 bg-background-secondary">
                    <TableRow>
                      <TableHead className="sticky left-0 z-10 bg-background-secondary min-w-[100px] cursor-pointer select-none" onClick={() => handleSort("specNumber")}>
                        <span className="inline-flex items-center text-xs">Spec<SortIcon column="specNumber" /></span>
                      </TableHead>
                      <TableHead className="sticky left-[100px] z-10 bg-background-secondary min-w-[120px] cursor-pointer select-none" onClick={() => handleSort("companyName")}>
                        <span className="inline-flex items-center text-xs">Company<SortIcon column="companyName" /></span>
                      </TableHead>
                      <TableHead className="min-w-[100px] cursor-pointer select-none" onClick={() => handleSort("customerSpec")}>
                        <span className="inline-flex items-center text-xs">Cust Spec<SortIcon column="customerSpec" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[75px] cursor-pointer select-none" onClick={() => handleSort("onHand")}>
                        <span className="inline-flex items-center justify-end text-xs">OnHand<SortIcon column="onHand" /></span>
                      </TableHead>
                      <TableHead className="text-right min-w-[80px]">
                        <span className="text-xs">{valueBasis === "cost" ? "Unit Cost" : "Unit Price"}</span>
                      </TableHead>
                      <TableHead className="text-right min-w-[100px]">
                        <span className="text-xs">OnHand $</span>
                      </TableHead>
                      {mrpBucketIndices.map((idx) => (
                        <TableHead key={idx} className="text-right min-w-[100px]">
                          <span className="text-xs">{projection.bucketDates[idx] ? formatShortDate(projection.bucketDates[idx]) : ""}</span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedSpecs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6 + mrpBucketIndices.length} className="text-center py-8 text-muted-foreground">No specs match the current filters</TableCell>
                      </TableRow>
                    ) : (
                      sortedSpecs.map((spec) => {
                        const rate = valueBasis === "cost" ? spec.unitCost : spec.unitPrice
                        return (
                          <TableRow key={spec.specNumber} className={`cursor-pointer hover:bg-background-hover transition-colors ${selectedSpec === spec.specNumber ? "bg-background-selected" : ""}`} onClick={() => handleRowClick(spec.specNumber)}>
                            <TableCell className="sticky left-0 z-10 bg-background-secondary font-mono text-xs font-medium">{spec.specNumber}</TableCell>
                            <TableCell className="sticky left-[100px] z-10 bg-background-secondary text-xs truncate max-w-[120px]">{spec.companyName}</TableCell>
                            <TableCell className="text-xs truncate max-w-[100px]">{spec.customerSpec}</TableCell>
                            <TableCell className={`text-right text-xs font-mono ${onHandCellClass(spec)}`}>{formatNumber(spec.onHand)}</TableCell>
                            <TableCell className="text-right text-xs font-mono">{formatCurrency(rate)}</TableCell>
                            <TableCell className={`text-right text-xs font-mono ${onHandCellClass(spec)}`}>{formatCurrency(spec.onHand * rate)}</TableCell>
                            {mrpBucketIndices.map((idx) => {
                              const bucket = spec.buckets[idx]
                              if (!bucket) return <TableCell key={idx} />
                              return (
                                <TableCell key={idx} className={`text-right text-xs font-mono ${healthCellClass(bucket.health)}`}>
                                  {formatCurrency(bucket.projected * rate)}
                                </TableCell>
                              )
                            })}
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                  <tfoot className="sticky bottom-0 z-20 bg-black text-white">
                    <TableRow className="font-semibold hover:bg-black">
                      <TableCell className="sticky left-0 z-10 bg-black text-xs">Total</TableCell>
                      <TableCell className="sticky left-[100px] z-10 bg-black text-xs" />
                      <TableCell className="text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatNumber(projection.totals.totalOnHand)}</TableCell>
                      <TableCell className="text-xs" />
                      <TableCell className="text-right text-xs font-mono">{formatCurrency(sortedSpecs.reduce((s, spec) => s + spec.onHand * (valueBasis === "cost" ? spec.unitCost : spec.unitPrice), 0))}</TableCell>
                      {valueBucketTotals.map((total, i) => (
                        <TableCell key={i} className="text-right text-xs font-mono">{formatCurrency(total)}</TableCell>
                      ))}
                    </TableRow>
                  </tfoot>
                </Table>
              </div>
            </Card>
          )}

          {/* ── Detail Panel ───────────────────────────── */}
          {selectedSpec && detailOpen && (
            <Card className="bg-background-secondary">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      Detail: {selectedSpec}
                      {selectedSpecData && (
                        <span className="ml-2 font-normal text-muted-foreground">— {selectedSpecData.companyName}</span>
                      )}
                    </h3>
                    {selectedSpecData && (
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>On Hand: <strong className="text-foreground">{formatNumber(selectedSpecData.onHand)}</strong></span>
                        <span>Min: <strong className="text-foreground">{formatNumber(selectedSpecData.minQty)}</strong></span>
                        <span>Max: <strong className="text-foreground">{formatNumber(selectedSpecData.maxQty)}</strong></span>
                        {selectedSpecData.shortageDate && <span>Shortage: <strong className="text-red-500">{formatShortDate(selectedSpecData.shortageDate)}</strong></span>}
                        {selectedSpecData.belowMinDate && <span>Below Min: <strong className="text-yellow-500">{formatShortDate(selectedSpecData.belowMinDate)}</strong></span>}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setDetailOpen(false); setSelectedSpec(null) }} className="h-7 w-7 p-0">
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                </div>

                {detailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
                  </div>
                ) : specDetail ? (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {/* Open MOs */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Open MOs ({specDetail.openMOs.length})</p>
                      <div className="overflow-auto max-h-[180px] border border-border rounded">
                        <Table className="[&_td]:py-1 [&_td]:px-2 [&_th]:py-1.5 [&_th]:px-2">
                          <TableHeader className="sticky top-0 z-10 bg-background-secondary">
                            <TableRow>
                              <TableHead className="text-xs">Job #</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs">Due</TableHead>
                              <TableHead className="text-xs">Status</TableHead>
                              <TableHead className="text-xs">Company</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {specDetail.openMOs.length === 0 ? (
                              <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-3">None</TableCell></TableRow>
                            ) : specDetail.openMOs.map((mo, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{mo.jobNum}</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(mo.remainingQty)}</TableCell>
                                <TableCell className="text-xs">{formatShortDate(mo.dueDate)}</TableCell>
                                <TableCell className="text-xs">{mo.orderStatus}</TableCell>
                                <TableCell className="text-xs truncate max-w-[100px]">{mo.companyName}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          {specDetail.openMOs.length > 0 && (
                            <tfoot className="sticky bottom-0 z-10 bg-black text-white">
                              <TableRow className="font-semibold">
                                <TableCell className="text-xs">Total</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(specDetail.openMOs.reduce((s, m) => s + m.remainingQty, 0))}</TableCell>
                                <TableCell colSpan={3} />
                              </TableRow>
                            </tfoot>
                          )}
                        </Table>
                      </div>
                    </div>

                    {/* Call Offs */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Open Call Offs ({specDetail.callOffs.length})</p>
                      <div className="overflow-auto max-h-[180px] border border-border rounded">
                        <Table className="[&_td]:py-1 [&_td]:px-2 [&_th]:py-1.5 [&_th]:px-2">
                          <TableHeader className="sticky top-0 z-10 bg-background-secondary">
                            <TableRow>
                              <TableHead className="text-xs">Job #</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs">Due</TableHead>
                              <TableHead className="text-xs">Status</TableHead>
                              <TableHead className="text-xs">Company</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {specDetail.callOffs.length === 0 ? (
                              <TableRow><TableCell colSpan={5} className="text-xs text-center text-muted-foreground py-3">None</TableCell></TableRow>
                            ) : specDetail.callOffs.map((co, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs font-mono">{co.jobNum}</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(co.remainingQty)}</TableCell>
                                <TableCell className="text-xs">{formatShortDate(co.dueDate)}</TableCell>
                                <TableCell className="text-xs">{co.orderStatus}</TableCell>
                                <TableCell className="text-xs truncate max-w-[100px]">{co.companyName}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          {specDetail.callOffs.length > 0 && (
                            <tfoot className="sticky bottom-0 z-10 bg-black text-white">
                              <TableRow className="font-semibold">
                                <TableCell className="text-xs">Total</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(specDetail.callOffs.reduce((s, c) => s + c.remainingQty, 0))}</TableCell>
                                <TableCell colSpan={3} />
                              </TableRow>
                            </tfoot>
                          )}
                        </Table>
                      </div>
                    </div>

                    {/* Ship Log */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Ship Log ({specDetail.shipLog.length})</p>
                      <div className="overflow-auto max-h-[180px] border border-border rounded">
                        <Table className="[&_td]:py-1 [&_td]:px-2 [&_th]:py-1.5 [&_th]:px-2">
                          <TableHeader className="sticky top-0 z-10 bg-background-secondary">
                            <TableRow>
                              <TableHead className="text-xs">Date</TableHead>
                              <TableHead className="text-xs text-right">Qty</TableHead>
                              <TableHead className="text-xs">Docket #</TableHead>
                              <TableHead className="text-xs">Company</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {specDetail.shipLog.length === 0 ? (
                              <TableRow><TableCell colSpan={4} className="text-xs text-center text-muted-foreground py-3">None</TableCell></TableRow>
                            ) : specDetail.shipLog.map((entry, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs">{formatShortDate(entry.shipDate)}</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(entry.qty)}</TableCell>
                                <TableCell className="text-xs font-mono">{entry.docketNumber}</TableCell>
                                <TableCell className="text-xs truncate max-w-[100px]">{entry.companyName}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                          {specDetail.shipLog.length > 0 && (
                            <tfoot className="sticky bottom-0 z-10 bg-black text-white">
                              <TableRow className="font-semibold">
                                <TableCell className="text-xs">Total</TableCell>
                                <TableCell className="text-xs text-right font-mono">{formatNumber(specDetail.shipLog.reduce((s, e) => s + e.qty, 0))}</TableCell>
                                <TableCell colSpan={2} />
                              </TableRow>
                            </tfoot>
                          )}
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
