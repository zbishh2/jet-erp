import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type InvoiceCostVarianceGranularity = "daily" | "weekly" | "monthly" | "yearly"

export interface InvoiceCostVarianceSummary {
  period: string
  estMaterialCost: number
  estLaborCost: number
  estFreightCost: number
  actMaterialCost: number
  actLaborCost: number
  actFreightCost: number
  estimatedHours: number
  quantity: number
}

export interface InvoiceCostVarianceDetailRow {
  invoiceDate: string
  invoiceNumber: string
  jobNumber: string
  customerName: string
  specNumber: string
  quantity: number
  estMaterialCost: number
  estLaborCost: number
  estFreightCost: number
  actMaterialCost: number
  actLaborCost: number
  actFreightCost: number
  estimatedHours: number
  stdRunRate: number
  setupMins: number
  jetBoardCostPerM: number | null
  jetBoardAreaSqFt: number | null
  jetBoardNup: number | null
  jetCostPerMSF: number | null
  jetCostSource: string | null
}

export interface InvoiceCostVarianceFilterOptions {
  customers: string[]
  salesReps: string[]
  specs: string[]
  jobs: string[]
}

export interface InvoiceCostVarianceDateLimits {
  minDate: string | null
  maxDate: string | null
}

function addFilters(params: URLSearchParams, customer?: string, salesRep?: string, spec?: string, job?: string) {
  if (customer) params.set("customer", customer)
  if (salesRep) params.set("salesRep", salesRep)
  if (spec) params.set("spec", spec)
  if (job) params.set("job", job)
}

export function useInvoiceCostVarianceDateLimits() {
  return useQuery({
    queryKey: ["invoice-cost-variance", "date-limits"],
    queryFn: () => apiFetch<{ data: InvoiceCostVarianceDateLimits[] }>("/erp/invoice-cost-variance/date-limits"),
    staleTime: 1000 * 60 * 30,
  })
}

export function useInvoiceCostVarianceSummary(
  startDate: string,
  endDate: string,
  granularity: InvoiceCostVarianceGranularity = "daily",
  customer?: string,
  salesRep?: string,
  spec?: string,
  job?: string
) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "summary", startDate, endDate, granularity, customer ?? "all", salesRep ?? "all", spec ?? "all", job ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      addFilters(params, customer, salesRep, spec, job)
      return apiFetch<{ data: InvoiceCostVarianceSummary[] }>(`/erp/invoice-cost-variance/summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export interface InvoiceCostVarianceDetailTotals {
  estMaterialCost: number
  estLaborCost: number
  estFreightCost: number
  actMaterialCost: number
  actLaborCost: number
  actFreightCost: number
  quantity: number
  estimatedHours: number
}

export interface InvoiceCostVariancePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface InvoiceCostVarianceDetailsResponse {
  data: InvoiceCostVarianceDetailRow[]
  totals: InvoiceCostVarianceDetailTotals
  pagination: InvoiceCostVariancePagination
}

export function useInvoiceCostVarianceDetails(
  startDate: string,
  endDate: string,
  page: number,
  pageSize: number,
  sortField?: string,
  sortDir?: string,
  customer?: string,
  salesRep?: string,
  spec?: string,
  job?: string
) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "details", startDate, endDate, page, pageSize, sortField ?? "", sortDir ?? "", customer ?? "all", salesRep ?? "all", spec ?? "all", job ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, page: String(page), pageSize: String(pageSize) })
      if (sortField) params.set("sortField", sortField)
      if (sortDir) params.set("sortDir", sortDir)
      addFilters(params, customer, salesRep, spec, job)
      return apiFetch<InvoiceCostVarianceDetailsResponse>(`/erp/invoice-cost-variance/details?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
    placeholderData: (prev) => prev,
  })
}

// ---------------------------------------------------------------------------
// Job detail (single-job cost breakdown)
// ---------------------------------------------------------------------------

export interface JobDetailCostComparison {
  materialPerM: { pre: number; post: number }
  labourPerM: { pre: number; post: number }
  freightPerM: { pre: number; post: number }
  fullCostPerM: { pre: number; post: number }
}

export interface CostDriverCalcLine {
  costRate: number
  variableAmount: number
  calcQty: number
  ruleQty: number
  totalCostPerM: number
}

export interface JobDetailCostDriver {
  costRuleID: number
  description: string
  preCostPerM: number
  postCostPerM: number
  preCalcLines: CostDriverCalcLine[]
  postCalcLines: CostDriverCalcLine[]
}

export interface JobDetailInvoice {
  invoiceNumber: string
  invoiceDate: string
  quantity: number
  unitPrice: number
  goodsValue: number
}

export interface BoardLine {
  type: 'pre' | 'post'
  ruleId: number
  description: string
  totalCostPerM: number
  calcQty: number
  costRate: number
  variableAmount: number
}

export interface JobDetailBoardAnalysis {
  boardGrade: string
  stdCostPerMSF: number
  boardAreaPerM: number
  boardLines: BoardLine[]
  preCost: { totalCostPerM: number }
  postCost: { totalCostPerM: number }
}

export interface JobDetailData {
  jobNumber: string
  specNumber: string
  description: string
  customerName: string
  orderQty: number
  actualQty: number
  route: string
  preCostDate: string
  postCostDate: string
  costComparison: JobDetailCostComparison
  costDrivers: JobDetailCostDriver[]
  profitability: {
    avgPricePerM: number
    postCostPerM: number
    margin: number
    totalInvoiceQty: number
    totalInvoiceValue: number
  }
  invoices: JobDetailInvoice[]
  hasDoubleCounting: boolean
  boardAnalysis: JobDetailBoardAnalysis
  purchaseCosts: JobDetailPurchaseCost[]
  calloffAnalysis: CalloffAnalysis | null
  productionSteps: CalloffMfgStep[]
  jetBoardCost: JetBoardCost | null
}

export interface JetBoardCost {
  grossSheetAreaSqFt: number
  blankAreaSqFt: number
  nup: number
  shrinkagePct: number
  supplierCostPerMSF: number
  supplierName: string
  pricingBasis: string
  rawSupplierCost: number
  totalSheetsFed: number
  totalMSFConsumed: number
  totalBoardCost: number
  boardCostPerM: number
  kiwiPostCostPerM: number
  deltaPct: number | null
}

export interface CalloffMfgBoardLine {
  ruleId: number
  description: string
  costRate: number
  variableAmount: number
  totalCostPerM: number
}

export interface CalloffMfgStep {
  step: number
  series: number
  machine: string
  machineNumber: string
  nupIn: number
  nupOut: number
  qtyFedIn: number
  qtyProduced: number
  sheetsFed: number
  sheetsProduced: number
  runMins: number
  sheetsPerHr: number | null
}

export interface CalloffMfgJob {
  jobNumber: string
  boardCostPerM: number
  boardLines: CalloffMfgBoardLine[]
  numberUp: number | null
  sheetsIssued: number | null
  sheetsToDieCut: number | null
  blanksOut: number | null
  sheetWastePct: number | null
  dieCutMachine: string | null
  orderSheetsPerHr: number | null
  steps: CalloffMfgStep[]
}

export interface CalloffAnalysis {
  isCalloff: boolean
  stocklineId: number
  calloffBoardCostPerM: number
  mfgAvgBoardCostPerM: number
  costRatio: number | null
  mfgJobs: CalloffMfgJob[]
}

export interface JobDetailPurchaseCost {
  description: string
  supplier: string
  uom: string
  activeDate: string
  validToDate: string | null
  minQty: number
  costPerUom: number
}

export function useInvoiceJobDetail(job?: string) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "job-detail", job ?? ""],
    queryFn: () => apiFetch<{ data: JobDetailData }>(`/erp/invoice-cost-variance/job-detail?job=${encodeURIComponent(job!)}`),
    enabled: !!job,
    staleTime: 1000 * 60 * 5,
  })
}

// ---------------------------------------------------------------------------
// Spec Analysis
// ---------------------------------------------------------------------------

export interface SpecAnalysisCostComparison {
  estMaterialPerM: number
  actMaterialPerM: number
  estLaborPerM: number
  actLaborPerM: number
  estFreightPerM: number
  actFreightPerM: number
  estFullCostPerM: number
  actFullCostPerM: number
  avgPricePerM: number
}

export interface SpecAnalysisMonth {
  period: string
  quantity: number
  jobCount: number
  estFullCostPerM: number
  actFullCostPerM: number
  avgPricePerM: number
}

export interface SpecAnalysisJob {
  jobNumber: string
  lastInvoiceDate: string
  quantity: number
  estFullCostPerM: number
  actFullCostPerM: number
  estMaterialPerM: number
  actMaterialPerM: number
  estLaborPerM: number
  actLaborPerM: number
  revenue: number
}

export interface SpecAnalysisData {
  spec: string
  totalQty: number
  totalJobs: number
  totalRevenue: number
  costComparison: SpecAnalysisCostComparison
  months: SpecAnalysisMonth[]
  jobs: SpecAnalysisJob[]
}

export function useSpecAnalysis(spec?: string) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "spec-analysis", spec ?? ""],
    queryFn: () => apiFetch<{ data: SpecAnalysisData }>(`/erp/invoice-cost-variance/spec-analysis?spec=${encodeURIComponent(spec!)}`),
    enabled: !!spec,
    staleTime: 1000 * 60 * 5,
  })
}

export function useInvoiceCostVarianceFilterOptions(
  startDate: string,
  endDate: string,
  customer?: string,
  salesRep?: string,
  spec?: string,
  job?: string
) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "filter-options", startDate, endDate, customer ?? "all", salesRep ?? "all", spec ?? "all", job ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, customer, salesRep, spec, job)
      return apiFetch<{ data: InvoiceCostVarianceFilterOptions }>(`/erp/invoice-cost-variance/filter-options?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}
