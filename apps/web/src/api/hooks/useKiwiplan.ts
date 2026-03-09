import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

// Types matching the gateway responses
export interface KiwiplanQuote {
  quoteId: number
  quoteNumber: string
  customerName: string | null
  quoteDate: string
  status: string
  validUntil: string | null
  companyID: number
}

export interface KiwiplanProductDesign {
  productDesignId: number
  designNumber: string
  description: string | null
  internalLength: number | null
  internalWidth: number | null
  internalDepth: number | null
  finishedLength: number | null
  finishedWidth: number | null
  finishedArea: number | null
  status: string
  companyID: number
}

export interface KiwiplanQuoteDetail extends KiwiplanQuote {
  comments: string | null
  headercomments: string | null
  footercomments: string | null
  products: KiwiplanProductDesign[]
}

export interface KiwiplanCustomer {
  customerId: number
  customerNumber: string
  name: string
  isCustomer: number
  isSupplier: number
}

export interface KiwiplanCustomerDetail {
  customerId: number
  customerNumber: string
  name: string
  comments: string | null
  quickcode: string | null
  status: string
}

export interface KiwiplanCostRule {
  ruleId: number
  ruleName: string
  accountName: string | null
  costFormula: string | null
  priceFormula: string | null
  conditionExpression: string | null
  variableAmount: string | null
  fixedAmount: string | null
  activedate: string
  expirydate: string | null
}

export interface KiwiplanCostEstimate {
  estimateId: number
  productDesignID: number
  fullCost: number | null
  materialCost: number | null
  labourCost: number | null
  freightCost: number | null
  otherDirectCost: number | null
  otherIndirectCost: number | null
  costingDate: string | null
  quantity: number | null
}

// Reference data types
export interface KiwiplanBoardGrade {
  boardId: number
  code: string
  description: string | null
  density: number | null
  thickness: number | null
  costPerArea: number | null
  isObsolete: number
  basicBoardName: string | null
}

export interface KiwiplanInk {
  inkId: number
  code: string
  description: string | null
  isCoating: number
  colorGroup: string | null
  mapCode: string | null
  isObsolete: number
  coatingTypeName: string | null
}

export interface KiwiplanStyle {
  styleId: number
  code: string
  description: string | null
  status: string | null
  analysisGroup: string | null
  imageName: string | null
  unitDescription: string | null
}

export interface KiwiplanPlantRate {
  rateId: number
  machineNumber: number | null
  costRate: number | null
  priceRate: number | null
  activeDate: string
  expiryDate: string | null
  costRuleName: string | null
  plantName: string | null
}

export interface KiwiplanAddress {
  addressId: number
  street: string | null
  city: string | null
  state: string | null
  zipcode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  isshiptodefault: number
  deliveryRegionID: number | null
  standardDespatchModeID: number | null
}

export interface KiwiplanFreightZone {
  freightZoneId: number
  journeydistance: number | null
  journeyduration: number | null
  freightper: number | null
  fullloadfreightcharge: number | null
  partloadfreightcharge: number | null
  fromAddressID: number | null
}

export interface KiwiplanDespatchMode {
  despatchModeId: number
  name: string
  iscustomerpickup: number
}

export interface KiwiplanRouteStep {
  machineno: number
  machinename: string | null
  machinegroup: string | null
  sequencenumber: number
  routingstdrunrate: number | null
  costingstdrunrate: number | null
  routingstdsetupmins: number | null
  costingstdsetupmins: number | null
  inkcount: number | null
  routingcrew: number | null
  costingcrew: number | null
}

// Response types
interface ListResponse<T> {
  data: T[]
  page: number
  pageSize: number
}

interface ItemResponse<T> {
  data: T
}

interface CostRulesResponse {
  data: KiwiplanCostRule[]
  count: number
}

// Filter interfaces
// Note: companyId is derived from server environment, not passed by client
export interface QuoteListFilters {
  page?: number
  pageSize?: number
}

export interface CustomerListFilters {
  page?: number
  pageSize?: number
  search?: string
}

// Hooks

export function useKiwiplanHealth() {
  return useQuery({
    queryKey: ["kiwiplan", "health"],
    queryFn: () => apiFetch<{ status: string; devMode: boolean; timestamp: string }>("/erp/health"),
    staleTime: 1000 * 60, // 1 minute
    retry: false,
  })
}

export function useKiwiplanQuotes(filters: QuoteListFilters = {}) {
  const { page = 1, pageSize = 20 } = filters

  return useQuery({
    queryKey: ["kiwiplan", "quotes", { page, pageSize }],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
      return apiFetch<ListResponse<KiwiplanQuote>>(`/erp/quotes?${params}`)
    },
    placeholderData: keepPreviousData,
  })
}

export function useKiwiplanQuote(quoteId: number | undefined) {
  return useQuery({
    queryKey: ["kiwiplan", "quote", quoteId],
    queryFn: () => apiFetch<ItemResponse<KiwiplanQuoteDetail>>(`/erp/quotes/${quoteId}`),
    enabled: !!quoteId,
  })
}

export function useKiwiplanCustomers(filters: CustomerListFilters = {}) {
  const { page = 1, pageSize = 20, search } = filters

  return useQuery({
    queryKey: ["kiwiplan", "customers", { page, pageSize, search }],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
      if (search) params.set("search", search)
      return apiFetch<ListResponse<KiwiplanCustomer>>(`/erp/customers?${params}`)
    },
    placeholderData: keepPreviousData,
  })
}

export function useKiwiplanCustomer(customerId: number | undefined) {
  return useQuery({
    queryKey: ["kiwiplan", "customer", customerId],
    queryFn: () => apiFetch<ItemResponse<KiwiplanCustomerDetail>>(`/erp/customers/${customerId}`),
    enabled: !!customerId,
  })
}

export function useKiwiplanCostRules() {
  return useQuery({
    queryKey: ["kiwiplan", "costRules"],
    queryFn: () => apiFetch<CostRulesResponse>("/erp/costing/rules"),
    staleTime: 1000 * 60 * 5, // 5 minutes - cost rules don't change often
  })
}

export function useKiwiplanCostEstimate(productDesignId: number | undefined) {
  return useQuery({
    queryKey: ["kiwiplan", "costEstimate", productDesignId],
    queryFn: () => apiFetch<ItemResponse<KiwiplanCostEstimate>>(`/erp/costing/estimate/${productDesignId}`),
    enabled: !!productDesignId,
  })
}

// Reference data hooks (system-wide, no companyId needed)

export function useKiwiplanBoardGrades() {
  return useQuery({
    queryKey: ["kiwiplan", "boardGrades"],
    queryFn: () => apiFetch<{ data: KiwiplanBoardGrade[] }>("/erp/boards"),
    staleTime: 1000 * 60 * 10, // 10 minutes - reference data doesn't change often
  })
}

export function useKiwiplanInks() {
  return useQuery({
    queryKey: ["kiwiplan", "inks"],
    queryFn: () => apiFetch<{ data: KiwiplanInk[] }>("/erp/inks"),
    staleTime: 1000 * 60 * 10, // 10 minutes
  })
}

export function useKiwiplanStyles() {
  return useQuery({
    queryKey: ["kiwiplan", "styles"],
    queryFn: () => apiFetch<{ data: KiwiplanStyle[] }>("/erp/styles"),
    staleTime: 1000 * 60 * 10, // 10 minutes
  })
}

export function useKiwiplanPlantRates() {
  return useQuery({
    queryKey: ["kiwiplan", "plantRates"],
    queryFn: () => apiFetch<{ data: KiwiplanPlantRate[] }>("/erp/rates"),
    staleTime: 1000 * 60 * 10, // 10 minutes
  })
}

// Address, Freight, Despatch, Routing hooks

export function useCustomerAddresses(customerId: number | undefined) {
  return useQuery({
    queryKey: ["kiwiplan", "addresses", customerId],
    queryFn: () => apiFetch<{ data: KiwiplanAddress[] }>(`/erp/addresses?customerId=${customerId}`),
    enabled: !!customerId,
    staleTime: 1000 * 60 * 5,
  })
}

export function useFreightZone(deliveryRegionId: number | undefined | null) {
  return useQuery({
    queryKey: ["kiwiplan", "freightZone", deliveryRegionId],
    queryFn: () => apiFetch<{ data: KiwiplanFreightZone | null }>(`/erp/addresses/freight-zone?deliveryRegionId=${deliveryRegionId}`),
    enabled: !!deliveryRegionId,
    staleTime: 1000 * 60 * 5,
  })
}

export function useDespatchMode(despatchModeId: number | undefined | null) {
  return useQuery({
    queryKey: ["kiwiplan", "despatchMode", despatchModeId],
    queryFn: () => apiFetch<{ data: KiwiplanDespatchMode }>(`/erp/addresses/despatch-mode/${despatchModeId}`),
    enabled: !!despatchModeId,
    staleTime: 1000 * 60 * 10,
  })
}

export function useRouting(productDesignId: number | undefined) {
  return useQuery({
    queryKey: ["kiwiplan", "routing", productDesignId],
    queryFn: () => apiFetch<{ data: KiwiplanRouteStep[] }>(`/erp/routing?productDesignId=${productDesignId}`),
    enabled: !!productDesignId,
  })
}

export function useRoutingStyleIds() {
  return useQuery({
    queryKey: ["kiwiplan", "routingStyleIds"],
    queryFn: () => apiFetch<{ data: number[] }>("/erp/routing/style-ids"),
    staleTime: 1000 * 60 * 10,
  })
}

export function useRoutingByStyle(styleId: number | undefined) {
  return useQuery({
    queryKey: ["kiwiplan", "routingByStyle", styleId],
    queryFn: () => apiFetch<{ data: KiwiplanRouteStep[] }>(`/erp/routing/by-style?styleId=${styleId}`),
    enabled: !!styleId,
    staleTime: 1000 * 60 * 10, // 10 minutes — routing templates don't change often
  })
}

// Score formula types
export interface ScoreFormula {
  groupId: number
  groupName: string
  formulaId: number
  formulaDescription: string | null
  formula: string
}

export interface StyleFormulaGroup {
  styleId: number
  code: string
  lwGroupId: number | null
  wwGroupId: number | null
}

export interface ScoreFormulaData {
  formulas: ScoreFormula[]
  styleGroups: StyleFormulaGroup[]
}

export function useScoreFormulas() {
  return useQuery({
    queryKey: ["kiwiplan", "scoreFormulas"],
    queryFn: () => apiFetch<ScoreFormulaData>("/erp/score-formulas"),
    staleTime: 1000 * 60 * 30, // 30 minutes
  })
}

export interface VolumeRankings {
  boards: Record<string, number>  // code → rank (0 = most popular)
  styles: Record<string, number>
}

export function useVolumeRankings() {
  return useQuery({
    queryKey: ["kiwiplan", "volumeRankings"],
    queryFn: () => apiFetch<VolumeRankings>("/erp/volume-rankings"),
    staleTime: 1000 * 60 * 60, // 1 hour
  })
}
