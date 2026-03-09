import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowLeft, Calculator, Search, X, Truck, Package, MoreHorizontal, Trash2, Loader2, Info } from "lucide-react"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { toast } from "sonner"
import {
  useKiwiplanBoardGrades,
  useKiwiplanStyles,
  useKiwiplanCustomers,
  useKiwiplanPlantRates,
  useCustomerAddresses,
  useFreightZone,
  useDespatchMode,
  useRoutingByStyle,
  useRoutingStyleIds,
  useScoreFormulas,
  type KiwiplanCustomer,
  type KiwiplanBoardGrade,
  type KiwiplanStyle,
  type KiwiplanAddress,
  type KiwiplanPlantRate,
  type KiwiplanRouteStep,
} from "@/api/hooks/useKiwiplan"
import {
  Button,
  Input,
  Label,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui"
import { calculateCosts, type CostInputs, type MachineStep } from "@/lib/cost-engine"
import { solveForPrice, calcContribution, type ContributionMetrics, type SolverTarget } from "@/lib/cost-solver"
import { useErpQuote, useCreateErpQuote, useUpdateErpQuote, useDeleteErpQuote } from "@/api/hooks/useErpQuotes"

// --- Reusable SearchableSelect Components ---

interface SearchableSelectProps<T> {
  items: T[]
  value: T | null
  onChange: (item: T | null) => void
  getLabel: (item: T) => string
  getSubLabel?: (item: T) => string
  getId: (item: T) => number
  placeholder?: string
  disabled?: boolean
}

function SearchableSelect<T>({
  items, value, onChange, getLabel, getSubLabel, getId, placeholder = "Search...", disabled,
}: SearchableSelectProps<T>) {
  const [search, setSearch] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const filteredItems = useMemo(() => {
    if (!search) return items.slice(0, 50)
    const lower = search.toLowerCase()
    return items.filter(item =>
      getLabel(item).toLowerCase().includes(lower) ||
      (getSubLabel && getSubLabel(item)?.toLowerCase().includes(lower))
    ).slice(0, 50)
  }, [items, search, getLabel, getSubLabel])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-tertiary" />
        <input
          type="text"
          value={value ? getLabel(value) : search}
          onChange={(e) => { setSearch(e.target.value); setIsOpen(true); if (value) onChange(null) }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-8 pr-8 py-1.5 text-sm border-0 bg-transparent focus:outline-none focus:ring-0"
        />
        {value && (
          <button onClick={() => { onChange(null); setSearch("") }} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-tertiary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {isOpen && filteredItems.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded shadow-lg max-h-48 overflow-y-auto">
          {filteredItems.map((item) => (
            <button key={getId(item)} onClick={() => { onChange(item); setSearch(""); setIsOpen(false) }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex justify-between items-center">
              <span className="font-medium">{getLabel(item)}</span>
              {getSubLabel && <span className="text-xs text-foreground-tertiary truncate ml-2">{getSubLabel(item)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface SearchableSelectWithQueryProps<T> {
  items: T[]
  value: T | null
  onChange: (item: T | null) => void
  onSearchChange: (search: string) => void
  searchValue: string
  getLabel: (item: T) => string
  getSubLabel?: (item: T) => string
  getId: (item: T) => number
  placeholder?: string
  isLoading?: boolean
}

function SearchableSelectWithQuery<T>({
  items, value, onChange, onSearchChange, searchValue, getLabel, getSubLabel, getId, placeholder = "Search...", isLoading,
}: SearchableSelectWithQueryProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-foreground-tertiary" />
        <input
          type="text"
          value={value ? getLabel(value) : searchValue}
          onChange={(e) => { onSearchChange(e.target.value); setIsOpen(true); if (value) onChange(null) }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full pl-8 pr-8 py-1.5 text-sm border-0 bg-transparent focus:outline-none focus:ring-0"
        />
        {value && (
          <button onClick={() => { onChange(null); onSearchChange("") }} className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-tertiary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
        {isLoading && !value && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-foreground-secondary" />
          </div>
        )}
      </div>
      {isOpen && items.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-background border border-border rounded shadow-lg max-h-48 overflow-y-auto">
          {items.map((item) => (
            <button key={getId(item)} onClick={() => { onChange(item); onSearchChange(""); setIsOpen(false) }} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex justify-between items-center">
              <span className="font-medium">{getLabel(item)}</span>
              {getSubLabel && <span className="text-xs text-foreground-tertiary truncate ml-2">{getSubLabel(item)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Helper ---
const fmt = (value: number, decimals = 2) =>
  value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

// Plant target ($/hr) for index calculation
const DEFAULT_PLANT_TARGET = 150

/**
 * Get labor and mfg rates for a specific machine number from plant rates.
 * Matches by machineNumber, then filters by costRuleName pattern.
 * Tie-break: most recent activeDate, then highest rateId (deterministic).
 */
export function getRatesForMachine(
  machineNo: number,
  plantRates: KiwiplanPlantRate[],
  fallbackLabor: number,
  fallbackMfg: number,
): { labor: number; mfg: number } {
  const machineRates = plantRates
    .filter(r => r.machineNumber === machineNo)
    .sort((a, b) => {
      // Sort by activeDate DESC, then rateId DESC for deterministic tie-break
      const dateCompare = (b.activeDate ?? "").localeCompare(a.activeDate ?? "")
      if (dateCompare !== 0) return dateCompare
      return (b.rateId ?? 0) - (a.rateId ?? 0)
    })

  const laborRate = machineRates.find(r => {
    const name = r.costRuleName?.toLowerCase() ?? ""
    return name.includes("labour") || name.includes("labor")
  })

  const mfgRate = machineRates.find(r => {
    const name = r.costRuleName?.toLowerCase() ?? ""
    return name.includes("manufacturing") || name.includes("mfg overhead") || name.includes("direct mfg")
  })

  // Only use fallback if this machine has *some* rates in cstPlantRate.
  // Machines with no rates at all (e.g. Board Supply, Strapper) get 0.
  if (machineRates.length === 0) {
    return { labor: 0, mfg: 0 }
  }

  return {
    labor: laborRate?.costRate ?? fallbackLabor,
    mfg: mfgRate?.costRate ?? fallbackMfg,
  }
}

/**
 * Build MachineStep[] from Kiwiplan routing steps and plant rates.
 * Applies QTY/H override to the first (primary) step if user has set it.
 */
export function buildMachineSteps(
  routeSteps: KiwiplanRouteStep[],
  plantRates: KiwiplanPlantRate[],
  fallbackLabor: number,
  fallbackMfg: number,
  qtyPerHourOverride?: number,
): MachineStep[] {
  // Find the primary production step (first with a real rate, not 999999 passthrough)
  const primaryIdx = routeSteps.findIndex(s => {
    const rate = s.routingstdrunrate ?? s.costingstdrunrate ?? 0
    return rate > 0 && rate < 999999
  })

  return routeSteps.map((step, i) => {
    const rates = getRatesForMachine(step.machineno, plantRates, fallbackLabor, fallbackMfg)
    const baseRunRate = step.routingstdrunrate ?? step.costingstdrunrate ?? 0
    const runRate = (i === primaryIdx && qtyPerHourOverride && qtyPerHourOverride > 0)
      ? qtyPerHourOverride
      : baseRunRate

    return {
      machineName: step.machinename ?? `Machine ${step.machineno}`,
      machineNumber: step.machineno,
      sequenceNumber: step.sequencenumber,
      runRate,
      setupMins: step.routingstdsetupmins ?? step.costingstdsetupmins ?? 0,
      laborRate: rates.labor,
      mfgRate: rates.mfg,
    }
  })
}

// --- Main Component ---

export default function QuoteForm() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isEditMode = !!id

  // --- Load existing quote for edit mode ---
  const existingQuoteQuery = useErpQuote(id)
  const existingQuote = existingQuoteQuery.data?.data
  const [initialized, setInitialized] = useState(false)

  // --- Delete dialog ---
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const deleteQuote = useDeleteErpQuote()
  const [deleting, setDeleting] = useState(false)

  // --- Selection state ---
  const [selectedCustomer, setSelectedCustomer] = useState<KiwiplanCustomer | null>(null)
  const [customerSearch, setCustomerSearch] = useState("")
  const [selectedAddress, setSelectedAddress] = useState<KiwiplanAddress | null>(null)
  const [selectedBoard, setSelectedBoard] = useState<KiwiplanBoardGrade | null>(null)
  const [selectedStyle, setSelectedStyle] = useState<KiwiplanStyle | null>(null)
  const [shippingMethod, setShippingMethod] = useState<"freight" | "cpu">("freight")

  // --- Form inputs ---
  const [quantity, setQuantity] = useState(5000)
  const [length, setLength] = useState(12)
  const [width, setWidth] = useState(10)
  const [depth, setDepth] = useState(8)
  const [inkCoveragePct, setInkCoveragePct] = useState(0)
  const [isGlued, setIsGlued] = useState(true)
  const [qtyPerHour, setQtyPerHour] = useState(0) // QTY/H — primary what-if input (machine speed)
  const [qtyPerHourTouched, setQtyPerHourTouched] = useState(false) // Track manual QTY/H entry
  const [sqFtOverride, setSqFtOverride] = useState<number | null>(null) // Manual blank area override

  // --- What-if editable field ---
  const [whatIfField, setWhatIfField] = useState<SolverTarget["type"] | null>(null)
  const [whatIfValue, setWhatIfValue] = useState(0)

  const [plantTarget] = useState(DEFAULT_PLANT_TARGET)

  // --- Queries ---
  const customersQuery = useKiwiplanCustomers({ search: customerSearch, pageSize: 50 })
  const boardsQuery = useKiwiplanBoardGrades()
  const stylesQuery = useKiwiplanStyles()
  const plantRatesQuery = useKiwiplanPlantRates()
  const addressesQuery = useCustomerAddresses(selectedCustomer?.customerId)
  const freightZoneQuery = useFreightZone(selectedAddress?.deliveryRegionID)
  const despatchModeQuery = useDespatchMode(selectedAddress?.standardDespatchModeID)
  const routingQuery = useRoutingByStyle(selectedStyle?.styleId)
  const routingStyleIdsQuery = useRoutingStyleIds()
  const scoreFormulasQuery = useScoreFormulas()

  const customers = customersQuery.data?.data ?? []
  const boards = boardsQuery.data?.data ?? []
  const styles = stylesQuery.data?.data ?? []
  const routingStyleIds = useMemo(() => new Set(routingStyleIdsQuery.data?.data ?? []), [routingStyleIdsQuery.data])
  const plantRates = plantRatesQuery.data?.data ?? []
  const addresses = addressesQuery.data?.data ?? []
  const freightZone = freightZoneQuery.data?.data ?? null
  const despatchMode = despatchModeQuery.data?.data ?? null
  const routeSteps = routingQuery.data?.data ?? []

  // Freight: Jet doesn't populate orgFreightZone.freightper — the actual rate
  // is stored in cstPlantRate as "Freight - Mileage Based" ($/cwt per mile).
  // Effective $/cwt = mileageRate × journeyDistance / 100
  const freightMileageRate = useMemo(() => {
    const rate = plantRates.find(r => r.costRuleName?.toLowerCase().includes("freight") && r.costRuleName?.toLowerCase().includes("mileage"))
    return rate?.costRate ?? 0
  }, [plantRates])

  const effectiveFreightPerCwt = useMemo(() => {
    const distance = freightZone?.journeydistance ?? 0
    if (freightMileageRate > 0 && distance > 0) {
      return freightMileageRate * distance / 100
    }
    // Fallback to freightper if populated
    return freightZone?.freightper ?? 0
  }, [freightMileageRate, freightZone])

  // --- Populate form from existing quote ---
  useEffect(() => {
    if (!existingQuote || initialized) return
    const line = existingQuote.lines?.[0]

    setSelectedCustomer({
      customerId: existingQuote.customerId,
      customerNumber: "",
      name: existingQuote.customerName,
      isCustomer: 1,
      isSupplier: 0,
    })
    setShippingMethod(existingQuote.shippingMethod as "freight" | "cpu")

    if (line) {
      setQuantity(line.quantity)
      setLength(line.length ?? 12)
      setWidth(line.width ?? 10)
      setDepth(line.depth ?? 8)
      setInkCoveragePct(line.inkCoveragePercent)
      setIsGlued(!!line.isGlued)
      if (line.pricePerM) {
        setWhatIfField("pricePerM")
        setWhatIfValue(line.pricePerM)
      }
      if (line.qtyPerHour) {
        setQtyPerHour(line.qtyPerHour)
        setQtyPerHourTouched(true)
      }
    }

    setInitialized(true)
  }, [existingQuote, initialized])

  // Match board/style from reference data once loaded
  useEffect(() => {
    if (!existingQuote || !initialized) return
    const line = existingQuote.lines?.[0]
    if (!line) return

    if (line.boardGradeId && boards.length > 0 && !selectedBoard) {
      const board = boards.find(b => b.boardId === line.boardGradeId)
      if (board) setSelectedBoard(board)
    }
    if (line.boxStyle && styles.length > 0 && !selectedStyle) {
      const style = styles.find(s => s.code === line.boxStyle)
      if (style) setSelectedStyle(style)
    }
  }, [existingQuote, initialized, boards, styles, selectedBoard, selectedStyle])

  // Auto-select default ship-to when addresses load
  useEffect(() => {
    if (addresses.length > 0 && !selectedAddress) {
      if (existingQuote?.shipToAddressId) {
        const saved = addresses.find(a => a.addressId === existingQuote.shipToAddressId)
        if (saved) { setSelectedAddress(saved); return }
      }
      const defaultAddr = addresses.find(a => a.isshiptodefault === 1) || addresses[0]
      setSelectedAddress(defaultAddr)
    }
  }, [addresses, selectedAddress, existingQuote])

  // Auto-set shipping method from despatch mode (only for new quotes)
  useEffect(() => {
    if (despatchMode && !isEditMode) {
      setShippingMethod(despatchMode.iscustomerpickup ? "cpu" : "freight")
    }
  }, [despatchMode, isEditMode])

  // Auto-default QTY/H from routing's primary production machine speed
  // Skip passthrough steps (rate 999999 = no bottleneck sentinel)
  useEffect(() => {
    if (routeSteps.length > 0 && !qtyPerHourTouched) {
      const prodStep = routeSteps.find(s => {
        const rate = s.routingstdrunrate ?? s.costingstdrunrate ?? 0
        return rate > 0 && rate < 999999
      })
      if (prodStep) {
        setQtyPerHour(prodStep.routingstdrunrate ?? prodStep.costingstdrunrate ?? 0)
      }
    }
  }, [routeSteps, qtyPerHourTouched])

  // Mutations
  const createQuote = useCreateErpQuote()
  const updateQuote = useUpdateErpQuote(id ?? "")
  const [isSaving, setIsSaving] = useState(false)

  // Reset address when customer changes
  const handleCustomerChange = useCallback((customer: KiwiplanCustomer | null) => {
    setSelectedCustomer(customer)
    setSelectedAddress(null)
  }, [])

  // --- Cost Engine ---
  // Derive average labor & mfg rates as fallbacks when no per-machine rate exists
  const avgRates = useMemo(() => {
    if (plantRates.length === 0) return { labor: 50, mfg: 40 }
    const laborRates = plantRates.filter(r =>
      r.costRuleName?.toLowerCase().includes("labour") ||
      r.costRuleName?.toLowerCase().includes("labor")
    )
    const mfgRates = plantRates.filter(r =>
      r.costRuleName?.toLowerCase().includes("manufacturing") ||
      r.costRuleName?.toLowerCase().includes("mfg overhead") ||
      r.costRuleName?.toLowerCase().includes("direct mfg")
    )
    const avgLabor = laborRates.length > 0
      ? laborRates.reduce((sum, r) => sum + (r.costRate ?? 0), 0) / laborRates.length
      : 50
    const avgMfg = mfgRates.length > 0
      ? mfgRates.reduce((sum, r) => sum + (r.costRate ?? 0), 0) / mfgRates.length
      : 40
    return { labor: avgLabor, mfg: avgMfg }
  }, [plantRates])

  // Build machine steps from Kiwiplan routing (with per-machine rates),
  // or fall back to manual QTY/H single-step when no routing available
  const machineSteps = useMemo((): MachineStep[] => {
    if (routeSteps.length > 0) {
      // Real routing from Kiwiplan — use per-machine rates
      return buildMachineSteps(
        routeSteps,
        plantRates,
        avgRates.labor,
        avgRates.mfg,
        qtyPerHourTouched ? qtyPerHour : undefined,
      )
    }
    // Fallback: manual QTY/H with averaged rates
    if (qtyPerHour <= 0) return []
    return [{
      machineName: "Primary",
      machineNumber: 1,
      sequenceNumber: 1,
      runRate: qtyPerHour,
      setupMins: 30,
      laborRate: avgRates.labor,
      mfgRate: avgRates.mfg,
    }]
  }, [routeSteps, plantRates, avgRates, qtyPerHour, qtyPerHourTouched])

  const costInputs = useMemo((): CostInputs => ({
    length,
    width,
    depth,
    boardCostPerMSF: selectedBoard?.costPerArea ?? 0,
    boardDensity: selectedBoard?.density ?? 0,
    inkCoveragePercent: inkCoveragePct,
    isHalfUp: false,
    isGlued,
    machineSteps,
    shippingMethod,
    freightPer: effectiveFreightPerCwt,
    journeyDistance: freightZone?.journeydistance ?? 0,
    inkStdRate: 3.50,
    glueCostPerPiece: 0.002,
    sgaPercent: 18,
    fixedMfgPercent: 35,
    quantity,
    styleCode: selectedStyle?.code,
    basicBoardName: selectedBoard?.basicBoardName,
    formulaData: scoreFormulasQuery.data,
    blankAreaOverride: sqFtOverride,
  }), [length, width, depth, selectedBoard, inkCoveragePct, isGlued, machineSteps, shippingMethod, effectiveFreightPerCwt, freightZone, quantity, selectedStyle, scoreFormulasQuery.data, sqFtOverride])

  const costs = useMemo(() => calculateCosts(costInputs), [costInputs])

  // --- Pricing: either from solver (what-if) or from cost engine ---
  const pricePerM = useMemo(() => {
    if (whatIfField && whatIfValue !== 0) {
      let target: SolverTarget
      switch (whatIfField) {
        case "pricePerM":
          target = { type: "pricePerM", value: whatIfValue }
          break
        case "contDollars":
          target = { type: "contDollars", value: whatIfValue }
          break
        case "contPercent":
          target = { type: "contPercent", value: whatIfValue }
          break
        case "contPerHour":
          target = { type: "contPerHour", value: whatIfValue, quantity }
          break
        case "index":
          target = { type: "index", value: whatIfValue, plantTarget, quantity }
          break
        default:
          return costs.pricePerM
      }
      return solveForPrice(target, costs)
    }
    return costs.pricePerM
  }, [whatIfField, whatIfValue, costs, quantity, plantTarget])

  const contribution = useMemo<ContributionMetrics>(
    () => calcContribution(pricePerM, costs, quantity, plantTarget),
    [pricePerM, costs, quantity, plantTarget]
  )

  // Default contribution (no what-if override) for reset buttons
  const defaultContribution = useMemo<ContributionMetrics>(
    () => calcContribution(costs.pricePerM, costs, quantity, plantTarget),
    [costs, quantity, plantTarget]
  )

  const isLoading = boardsQuery.isLoading || stylesQuery.isLoading

  // --- Save handler ---
  const handleSave = useCallback(async () => {
    if (!selectedCustomer) return
    setIsSaving(true)
    const lineData = {
      lineNumber: 1,
      description: selectedStyle ? `${selectedStyle.code} ${length}x${width}x${depth}` : undefined,
      quantity,
      boxStyle: selectedStyle?.code,
      length,
      width,
      depth,
      boardGradeId: selectedBoard?.boardId,
      boardGradeCode: selectedBoard?.code,
      inkCoveragePercent: inkCoveragePct,
      isGlued,
      costSnapshot: JSON.stringify(costs),
      pricePerM: Math.round(pricePerM * 100) / 100,
      qtyPerHour: qtyPerHour > 0 ? qtyPerHour : undefined,
    }
    try {
      if (isEditMode && existingQuote) {
        await updateQuote.mutateAsync({
          customerId: selectedCustomer.customerId,
          customerName: selectedCustomer.name,
          shipToAddressId: selectedAddress?.addressId,
          shippingMethod,
          lines: [lineData],
          version: existingQuote.version,
        })
        toast.success("Quote saved")
      } else {
        await createQuote.mutateAsync({
          customerId: selectedCustomer.customerId,
          customerName: selectedCustomer.name,
          shipToAddressId: selectedAddress?.addressId,
          shippingMethod,
          lines: [lineData],
        })
        toast.success("Quote created")
      }
      navigate("/erp/quotes")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save quote")
    } finally {
      setIsSaving(false)
    }
  }, [selectedCustomer, selectedAddress, shippingMethod, selectedStyle, length, width, depth, quantity, selectedBoard, inkCoveragePct, isGlued, costs, pricePerM, qtyPerHour, createQuote, updateQuote, isEditMode, existingQuote, navigate])

  // --- Delete handler ---
  const handleDelete = async () => {
    if (!id) return
    setDeleting(true)
    try {
      await deleteQuote.mutateAsync(id)
      toast.success("Quote deleted")
      navigate("/erp/quotes")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete quote")
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }

  // --- What-if field handler ---
  const handleWhatIfChange = useCallback((field: SolverTarget["type"], value: string) => {
    const num = parseFloat(value) || 0
    setWhatIfField(field)
    setWhatIfValue(num)
  }, [])

  const whatIfDisplay = useCallback((field: SolverTarget["type"]): string => {
    if (whatIfField === field) return String(whatIfValue || "")
    switch (field) {
      case "pricePerM": return fmt(contribution.pricePerM)
      case "contDollars": return fmt(contribution.contDollars)
      case "contPercent": return fmt(contribution.contPercent, 1)
      case "contPerHour": return fmt(contribution.contPerHour)
      case "index": return fmt(contribution.index, 0)
      default: return ""
    }
  }, [whatIfField, whatIfValue, contribution])

  if (isEditMode && existingQuoteQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-foreground-secondary">Loading...</p>
      </div>
    )
  }

  return (
    <div className="h-full flex -mx-6 -mt-6">
      <div className="flex-1 px-6 pt-3 overflow-auto">
        {/* Header */}
        <div className="flex items-center gap-3 pb-2 mb-3 border-b border-border">
          <Button variant="ghost" size="icon" onClick={() => navigate("/erp/quotes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-medium truncate max-w-xs">
            {isEditMode ? existingQuote?.quoteNumber ?? "Quote" : "New Quote"}
          </span>
          {isEditMode && existingQuote && (
            <Badge variant="secondary" className="text-xs">{existingQuote.status}</Badge>
          )}
          {isEditMode && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Quote
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,7fr)] gap-6">
          {/* ====== LEFT COLUMN: Input Form ====== */}
          <div className="space-y-3">
            {/* Customer & Ship-To */}
            <div className="border border-border rounded-lg p-3 bg-background-secondary">
              <h3 className="text-xs font-semibold mb-2 text-foreground-secondary uppercase tracking-wide">Customer & Shipping</h3>
              <div className="space-y-2">
                <div className="space-y-0.5">
                  <Label className="text-xs text-foreground-secondary">Customer</Label>
                  <SearchableSelectWithQuery
                    items={customers}
                    value={selectedCustomer}
                    onChange={handleCustomerChange}
                    onSearchChange={setCustomerSearch}
                    searchValue={customerSearch}
                    getLabel={(c) => c.name}
                    getSubLabel={(c) => c.customerNumber}
                    getId={(c) => c.customerId}
                    placeholder="Search customers..."
                    isLoading={customersQuery.isLoading}
                  />
                </div>

                {/* Ship-To Address */}
                {selectedCustomer && (
                  <div className="space-y-0.5">
                    <Label className="text-xs text-foreground-secondary">Ship To</Label>
                    {addressesQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-xs text-foreground-tertiary py-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading...
                      </div>
                    ) : addresses.length === 0 ? (
                      <span className="text-xs text-foreground-tertiary">No addresses</span>
                    ) : (
                      <SearchableSelect
                        items={addresses}
                        value={selectedAddress}
                        onChange={setSelectedAddress}
                        getLabel={(a) => [a.street, a.city, a.state].filter(Boolean).join(", ")}
                        getSubLabel={(a) => a.isshiptodefault ? "Default" : ""}
                        getId={(a) => a.addressId}
                        placeholder="Select address..."
                      />
                    )}
                  </div>
                )}

                {/* Shipping & Quantity */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => { setShippingMethod("freight"); setWhatIfField(null) }}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-colors ${
                        shippingMethod === "freight"
                          ? "bg-accent text-white border-accent"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      <Truck className="h-3 w-3" />
                      Freight
                    </button>
                    <button
                      onClick={() => { setShippingMethod("cpu"); setWhatIfField(null) }}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium transition-colors ${
                        shippingMethod === "cpu"
                          ? "bg-accent text-white border-accent"
                          : "bg-background text-foreground border-border hover:bg-muted"
                      }`}
                    >
                      <Package className="h-3 w-3" />
                      CPU
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-foreground-secondary">Qty</Label>
                  <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => { setQuantity(parseInt(e.target.value) || 0); setWhatIfField(null) }}
                    className="border-0 bg-transparent px-0 w-20 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>

                {shippingMethod === "freight" && freightZone && (
                  <p className="text-[10px] text-foreground-tertiary">
                    {freightZone.journeydistance} mi / ${fmt(effectiveFreightPerCwt)}/cwt
                  </p>
                )}
              </div>
            </div>

            {/* Materials */}
            <div className="border border-border rounded-lg p-3 bg-background-secondary">
              <h3 className="text-xs font-semibold mb-2 text-foreground-secondary uppercase tracking-wide">Materials</h3>
              {isLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-foreground-secondary" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-0.5">
                    <Label className="text-xs text-foreground-secondary">Board Grade</Label>
                    <SearchableSelect
                      items={boards}
                      value={selectedBoard}
                      onChange={(b) => { setSelectedBoard(b); setWhatIfField(null) }}
                      getLabel={(b) => b.code}
                      getSubLabel={(b) => `${b.description || ""} - $${b.costPerArea?.toFixed(2)}/MSF`}
                      getId={(b) => b.boardId}
                      placeholder="Search board grades..."
                    />
                  </div>

                  <div className="space-y-0.5">
                    <Label className="text-xs text-foreground-secondary">Box Style</Label>
                    <SearchableSelect
                      items={styles}
                      value={selectedStyle}
                      onChange={(s) => { setSelectedStyle(s); setQtyPerHourTouched(false) }}
                      getLabel={(s) => s.code}
                      getSubLabel={(s) => {
                        const desc = s.description || ""
                        const hasRouting = routingStyleIds.has(s.styleId)
                        return hasRouting ? `${desc} ✦ routing` : desc
                      }}
                      getId={(s) => s.styleId}
                      placeholder="Search box styles..."
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-foreground-secondary">Ink %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      value={inkCoveragePct}
                      onChange={(e) => { setInkCoveragePct(parseFloat(e.target.value) || 0); setWhatIfField(null) }}
                      className="border-0 bg-transparent px-0 w-16 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-foreground-secondary">Glue Joint</Label>
                    <Switch
                      checked={isGlued}
                      onCheckedChange={(checked) => { setIsGlued(checked); setWhatIfField(null) }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Dimensions */}
            <div className="border border-border rounded-lg p-3 bg-background-secondary">
              <h3 className="text-xs font-semibold mb-2 text-foreground-secondary uppercase tracking-wide">Dimensions (in)</h3>
              <div className="space-y-1">
                {[
                  { label: "Length", value: length, set: setLength },
                  { label: "Width", value: width, set: setWidth },
                  { label: "Depth", value: depth, set: setDepth },
                ].map(({ label, value, set }) => (
                  <div key={label} className="flex items-center justify-between">
                    <Label className="text-xs text-foreground-secondary">{label}</Label>
                    <Input
                      type="number"
                      step="0.125"
                      value={value}
                      onChange={(e) => { set(parseFloat(e.target.value) || 0); setWhatIfField(null); setSqFtOverride(null) }}
                      className="border-0 bg-transparent px-0 w-20 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 pt-1.5 border-t border-border flex items-center justify-between gap-2">
                <Label className="text-xs text-foreground-secondary whitespace-nowrap">Sq Ft</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    step="0.001"
                    value={sqFtOverride != null ? sqFtOverride : costs.blankAreaSqFt.toFixed(3)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      setSqFtOverride(isNaN(v) ? null : v)
                    }}
                    className="border-0 bg-transparent px-0 w-20 text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  {sqFtOverride != null && (
                    <button
                      onClick={() => setSqFtOverride(null)}
                      className="text-foreground-tertiary hover:text-foreground"
                      title="Reset to calculated"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                  {sqFtOverride == null && costs.formulaUsed === 'kiwiplan' && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 leading-none font-semibold text-indigo-500 border-indigo-300">KP</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Routing Display */}
            {machineSteps.length > 0 && (
              <div className="border border-border rounded-lg p-3 bg-background-secondary">
                <h3 className="text-xs font-semibold mb-2 text-foreground-secondary uppercase tracking-wide flex items-center gap-2">
                  Routing
                  {routeSteps.length > 0 && (
                    <Badge variant="secondary" className="text-xs font-normal">Kiwiplan</Badge>
                  )}
                  {routingQuery.isLoading && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-secondary" />
                  )}
                </h3>
                <div className="text-xs font-mono space-y-1.5">
                  {machineSteps.map((step, i) => {
                    // Highlight the bottleneck (slowest machine with positive run rate)
                    const minRate = Math.min(...machineSteps.filter(s => s.runRate > 0).map(s => s.runRate))
                    const isBottleneck = step.runRate > 0 && step.runRate === minRate && machineSteps.length > 1
                    return (
                      <div key={i} className={`flex items-center justify-between gap-2 ${isBottleneck ? "text-amber-600 font-semibold" : ""}`}>
                        <span className="truncate"><span className="text-foreground-tertiary">{step.machineNumber}</span> {step.machineName}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span>{step.runRate.toLocaleString()} pcs/hr</span>
                          {step.setupMins > 0 && (
                            <span className="text-foreground-tertiary">{step.setupMins}m setup</span>
                          )}
                          {i === 0 && qtyPerHourTouched && routeSteps.length > 0 && (
                            <span className="text-accent text-[10px]">QTY/H</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ====== RIGHT COLUMN: Cost Breakdown + What-If ====== */}
          <div className="space-y-6">
            {/* Cost Breakdown */}
            <div className="border border-border rounded-lg p-4 bg-background-secondary sticky top-4">
              <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
                <Calculator className="h-4 w-4" />
                Cost Breakdown
              </h3>

              {/* Two-Column Cost Table */}
              <div className="font-mono text-base bg-background border border-border rounded p-3 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-1 pr-4 text-sm text-foreground-secondary">Category</th>
                      <th className="text-right py-1 px-2 text-sm text-foreground-secondary">$/M (Auto)</th>
                    </tr>
                  </thead>
                  <TooltipProvider delayDuration={200}>
                  <tbody className="text-sm">
                    {[
                      { label: "Board", value: costs.board, tip: `Board $/MSF × Blank Area\n$${fmt(costInputs.boardCostPerMSF)} × ${fmt(costs.blankAreaSqFt, 3)} sq ft = $${fmt(costs.board)}/M` },
                      { label: "Oth Mat", value: costs.othMat, tip: `Ink + Glue per M pieces\nInk: $${fmt(costInputs.inkStdRate)}/MSF × ${fmt(costs.blankAreaSqFt, 3)} sq ft × ${costInputs.inkCoveragePercent}% coverage\nGlue: $${costInputs.glueCostPerPiece}/pc × 1000` },
                      { label: "Dir Lab", value: costs.dirLab, tip: `Sum of (labor $/hr × hrs/M) per machine step\nhrs/M = 1000 ÷ run rate` },
                      { label: "Dir Mfg", value: costs.dirMfg, tip: `Sum of (mfg overhead $/hr × hrs/M) per machine step\nhrs/M = 1000 ÷ run rate` },
                      { label: "Trucking", value: costs.trucking, tip: shippingMethod === 'cpu' ? 'Customer pickup — no freight' : `Freight $/cwt × weight/M ÷ 100\n$${fmt(costInputs.freightPer)} × ${fmt(costs.weightPerM, 0)} lbs ÷ 100` },
                    ].map(({ label, value, tip }) => (
                      <tr key={label}>
                        <td className="py-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">{label}<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">{tip}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="text-right px-2">{fmt(value)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="py-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">*DIRECT<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">Board + Oth Mat + Dir Lab + Dir Mfg + Trucking</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="text-right px-2">{fmt(costs.direct)}</td>
                    </tr>
                    {[
                      { label: "Fix Mfg", value: costs.fixMfg, tip: `${costInputs.fixedMfgPercent}% of Dir Mfg\n$${fmt(costs.dirMfg)} × ${costInputs.fixedMfgPercent}% = $${fmt(costs.fixMfg)}` },
                      { label: "Whse", value: costs.whse, tip: "Warehouse cost — currently $0 (placeholder)" },
                    ].map(({ label, value, tip }) => (
                      <tr key={label}>
                        <td className="py-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 cursor-help">{label}<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">{tip}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="text-right px-2">{fmt(value)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="py-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">*PLANT<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">*DIRECT + Fix Mfg + Whse</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="text-right px-2">{fmt(costs.plant)}</td>
                    </tr>
                    <tr>
                      <td className="py-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">SG&A+<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">{`${costInputs.sgaPercent}% of *PLANT\n$${fmt(costs.plant)} × ${costInputs.sgaPercent}% = $${fmt(costs.sgaPlus)}`}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="text-right px-2">{fmt(costs.sgaPlus)}</td>
                    </tr>
                    <tr className="border-t border-border font-bold text-accent">
                      <td className="py-0.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 cursor-help">*100DEX<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">*PLANT + SG&A+ = total cost at 100% index</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="text-right px-2">{fmt(costs.total)}</td>
                    </tr>
                  </tbody>
                  </TooltipProvider>
                </table>

                {/* Physical Summary */}
                <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Blank Area:</span>
                    <span className="flex items-center gap-1">
                      {fmt(costs.blankAreaSqFt, 3)} sq ft
                      {costs.formulaUsed === 'kiwiplan' && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 leading-none font-semibold text-indigo-500 border-indigo-300">KP</Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Weight/M:</span>
                    <span>{fmt(costs.weightPerM, 0)} lbs</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Total Sq Ft:</span>
                    <span>{costs.totalSqFt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Total Wt:</span>
                    <span>{costs.totalWeight.toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs</span>
                  </div>
                  {costs.machineHours > 0 && (
                    <div className="flex justify-between">
                      <span className="text-foreground-secondary">Mach Hrs:</span>
                      <span>{fmt(costs.machineHours, 1)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-foreground-secondary">Setup:</span>
                    <span>${fmt(costs.setupCost)}</span>
                  </div>
                </div>
              </div>

              {/* What-If Section */}
              <div className="mt-4">
                <h4 className="text-base font-semibold text-foreground-secondary mb-2">What-If Pricing</h4>
                <div className="bg-background border border-border rounded p-3 space-y-2">
                  {/* QTY/H — primary speed input (drives machine hours, labor, contribution) */}
                  <TooltipProvider delayDuration={200}>
                  <div className="flex items-center gap-3 pb-2 border-b border-border">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-sm font-mono w-20 text-right font-semibold text-foreground-secondary inline-flex items-center justify-end gap-1 cursor-help">QTY/H<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">{`Machine speed (pcs/hr)\nDrives machine hours, labor, and mfg costs\nMach Hrs = setup + (1000 ÷ QTY/H) × qty/1000`}</TooltipContent>
                    </Tooltip>
                    <div className="relative flex-1 flex items-center gap-1">
                      <input
                        type="number"
                        step="100"
                        value={qtyPerHour || ""}
                        placeholder="Machine speed (pcs/hr)"
                        onChange={(e) => { setQtyPerHour(parseInt(e.target.value) || 0); setQtyPerHourTouched(true); setWhatIfField(null) }}
                        className={`w-full pl-2 pr-2 py-1.5 text-sm font-mono border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                          qtyPerHour > 0 ? "border-accent bg-accent/10" : ""
                        }`}
                      />
                      {qtyPerHourTouched && (() => {
                        const prodStep = routeSteps.find(s => {
                          const rate = s.routingstdrunrate ?? s.costingstdrunrate ?? 0
                          return rate > 0 && rate < 999999
                        })
                        const stdRate = prodStep?.routingstdrunrate ?? prodStep?.costingstdrunrate ?? 0
                        return stdRate > 0 && qtyPerHour !== stdRate ? (
                          <button
                            type="button"
                            onClick={() => { setQtyPerHour(stdRate); setQtyPerHourTouched(false); setWhatIfField(null) }}
                            className="text-[10px] text-accent hover:text-accent/80 whitespace-nowrap shrink-0"
                            title={`Reset to standard: ${stdRate.toLocaleString()}`}
                          >Std: {stdRate.toLocaleString()}</button>
                        ) : null
                      })()}
                    </div>
                    <span className="text-sm font-mono w-24 text-right text-foreground-tertiary">
                      {qtyPerHour > 0 ? `${fmt(costs.machineHours, 1)} hrs` : ""}
                    </span>
                  </div>
                  {[
                    { field: "pricePerM" as const, label: "PRICE/M", prefix: "$", tip: "Selling price per 1,000 pieces\nDefault = *100DEX (total cost at 100% index)" },
                    { field: "contDollars" as const, label: "CONT $/M", prefix: "$", tip: "Contribution dollars per 1,000 pieces\nPrice/M − *DIRECT" },
                    { field: "contPercent" as const, label: "CONT %", suffix: "%", tip: "Contribution as % of Price/M\n(CONT $/M ÷ Price/M) × 100" },
                    { field: "contPerHour" as const, label: "CONT/HR", prefix: "$", tip: `Contribution per machine hour\n(CONT $/M × qty/1000) ÷ Mach Hrs\nPlant target: $${fmt(plantTarget, 0)}/hr` },
                    { field: "index" as const, label: "INDEX", suffix: "", tip: `Performance index (CONT/HR ÷ plant target × 100)\n100 = breakeven, >100 = above target\nPlant target: $${fmt(plantTarget, 0)}/hr` },
                  ].map(({ field, label, prefix, suffix, tip }) => {
                    const needsQtyH = (field === "contPerHour" || field === "index") && costs.machineHours <= 0
                    const defaultVal = field === "pricePerM" ? defaultContribution.pricePerM
                      : field === "contDollars" ? defaultContribution.contDollars
                      : field === "contPercent" ? defaultContribution.contPercent
                      : field === "contPerHour" ? defaultContribution.contPerHour
                      : defaultContribution.index
                    const decimals = field === "contPercent" ? 1 : field === "index" ? 0 : 2
                    const isOverridden = whatIfField && whatIfField !== field
                    return (
                    <div key={field} className="flex items-center gap-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm font-mono w-20 text-right font-semibold text-foreground-secondary inline-flex items-center justify-end gap-1 cursor-help">{label}<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">{tip}</TooltipContent>
                      </Tooltip>
                      <div className="relative flex-1 flex items-center gap-1">
                        {needsQtyH ? (
                          <span className="block w-full pl-2 py-1.5 text-sm font-mono text-foreground-tertiary italic">Needs QTY/H</span>
                        ) : (
                        <>
                        <div className="relative flex-1">
                        {prefix && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-foreground-tertiary">{prefix}</span>}
                        <input
                          type="number"
                          step={field === "pricePerM" ? "0.01" : "any"}
                          value={whatIfField === field ? (whatIfValue || "") : ""}
                          placeholder={whatIfDisplay(field)}
                          onChange={(e) => {
                            let val = e.target.value
                            if (field === "pricePerM" && val) {
                              const parts = val.split(".")
                              if (parts[1] && parts[1].length > 2) val = `${parts[0]}.${parts[1].slice(0, 2)}`
                            }
                            handleWhatIfChange(field, val)
                          }}
                          className={`w-full ${prefix ? "pl-5" : "pl-2"} pr-6 py-1.5 text-sm font-mono border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                            whatIfField === field ? "border-accent bg-accent/10" : ""
                          }`}
                        />
                        {suffix && <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-foreground-tertiary">{suffix}</span>}
                        </div>
                        {isOverridden && (
                          <button
                            type="button"
                            onClick={() => { setWhatIfField(null); setWhatIfValue(0) }}
                            className="text-[10px] text-accent hover:text-accent/80 whitespace-nowrap shrink-0"
                            title={`Reset to auto: ${prefix ?? ""}${fmt(defaultVal, decimals)}${suffix ?? ""}`}
                          >{prefix ?? ""}{fmt(defaultVal, decimals)}{suffix ?? ""}</button>
                        )}
                        </>
                        )}
                      </div>
                      <span className="text-sm font-mono w-24 text-right text-foreground-tertiary">
                        {field === "pricePerM" && fmt(contribution.pricePerM)}
                        {field === "contDollars" && fmt(contribution.contDollars)}
                        {field === "contPercent" && `${fmt(contribution.contPercent, 1)}%`}
                        {field === "contPerHour" && (needsQtyH ? "-" : fmt(contribution.contPerHour))}
                        {field === "index" && (needsQtyH ? "-" : fmt(contribution.index, 0))}
                      </span>
                    </div>
                  )})}

                  {/* Derived read-only metrics */}
                  <div className="pt-2 border-t border-border space-y-1">
                    <div className="flex items-center gap-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-sm font-mono w-20 text-right text-foreground-secondary inline-flex items-center justify-end gap-1 cursor-help">$/MSF<Info className="h-3 w-3 text-foreground-tertiary" /></span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="max-w-xs whitespace-pre-line font-mono text-[11px] bg-background-secondary border border-border shadow-lg rounded-lg px-4 py-3 text-foreground">{`Price per 1,000 sq ft\nPrice/M ÷ blank area\n$${fmt(contribution.pricePerM)} ÷ ${fmt(costs.blankAreaSqFt, 3)} sq ft`}</TooltipContent>
                      </Tooltip>
                      <span className="text-sm font-mono">${fmt(contribution.dollarPerMSF)}</span>
                    </div>
                  </div>
                  </TooltipProvider>

                  {whatIfField && (
                    <button
                      onClick={() => { setWhatIfField(null); setWhatIfValue(0) }}
                      className="text-xs text-accent hover:underline"
                    >
                      Reset to auto-calculated
                    </button>
                  )}
                </div>
              </div>

              {/* Total Price */}
              <div className="mt-4 p-3 bg-background border border-accent/30 rounded">
                <div className="flex justify-between text-base font-bold text-accent">
                  <span>TOTAL PRICE:</span>
                  <span>${fmt(contribution.totalPrice)}</span>
                </div>
                <div className="flex justify-between text-sm text-foreground-secondary mt-1">
                  <span>Price/M: ${fmt(pricePerM)}</span>
                  <span>Qty: {quantity.toLocaleString()}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-4 pt-4 mt-4 border-t border-border">
                <Button variant="outline" onClick={() => navigate("/erp/quotes")}>Cancel</Button>
                <Button onClick={handleSave} disabled={!selectedCustomer || isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    isEditMode ? "Save Changes" : "Create Quote"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quote</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this quote? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
