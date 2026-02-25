import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type MrpGranularity = "day" | "week" | "2week" | "month"
export type HealthState = "good" | "adequate" | "belowMin" | "shortage"

export interface SpecBucket {
  projected: number
  demand: number
  supply: number
  health: HealthState
}

export interface MrpSpec {
  specNumber: string
  companyName: string
  customerSpec: string
  salesRep: string
  onHand: number
  minQty: number
  maxQty: number
  unitCost: number
  unitPrice: number
  last30DayUsage: number
  avg30DayUsage90: number
  minMonthsOfSupply: number | null
  maxMonthsOfSupply: number | null
  onHandMonthsOfSupply: number | null
  hasOrders: boolean
  hasMinOrMax: boolean
  shortageDate: string | null
  belowMinDate: string | null
  hasPastDues: boolean
  buckets: SpecBucket[]
}

export interface MrpTotals {
  totalOnHand: number
  totalMinQty: number
  totalMaxQty: number
  totalLast30d: number
  totalAvg30d: number
}

export interface MrpKpis {
  totalSKUs: number
  inShortage: number
  belowMin: number
  onHandCost: number
  onHandPrice: number
  projected4wCost: number
  projected4wPrice: number
  pastDueCount: number
}

export interface MrpProjectionResponse {
  bucketLabels: string[]
  bucketDates: string[]
  specs: MrpSpec[]
  totals: MrpTotals
  kpis: MrpKpis
}

export interface MrpOrder {
  jobNum: string
  remainingQty: number
  dueDate: string
  mrpType: string
  companyName: string
  orderStatus: string
}

export interface MrpShipLogEntry {
  specNumber: string
  shipDate: string
  qty: number
  companyName: string
  docketNumber: string
}

export interface MrpSpecDetailResponse {
  openMOs: MrpOrder[]
  callOffs: MrpOrder[]
  shipLog: MrpShipLogEntry[]
}

export function useMrpProjection(
  granularity: MrpGranularity,
  horizon: number,
  company: string,
  spec: string,
  filters: string[],
  hasOrders?: string,
  hasMinOrMax?: string
) {
  return useQuery({
    queryKey: ["mrp", "projection", granularity, horizon, company, spec, filters.join(","), hasOrders, hasMinOrMax],
    queryFn: () => {
      const params = new URLSearchParams({
        granularity,
        horizon: String(horizon),
      })
      if (company && company !== "all") params.set("company", company)
      if (spec) params.set("spec", spec)
      if (filters.length > 0) params.set("filter", filters.join(","))
      if (hasOrders && hasOrders !== "all") params.set("hasOrders", hasOrders)
      if (hasMinOrMax && hasMinOrMax !== "all") params.set("hasMinOrMax", hasMinOrMax)
      return apiFetch<MrpProjectionResponse>(`/erp/mrp/projection?${params}`)
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useMrpSpecDetail(specNumber: string | null) {
  return useQuery({
    queryKey: ["mrp", "spec-detail", specNumber],
    queryFn: () => {
      const params = new URLSearchParams({ spec: specNumber! })
      return apiFetch<MrpSpecDetailResponse>(`/erp/mrp/spec-detail?${params}`)
    },
    enabled: !!specNumber,
    staleTime: 1000 * 60 * 5,
  })
}

export function useMrpFilterOptions() {
  return useQuery({
    queryKey: ["mrp", "filter-options"],
    queryFn: () => apiFetch<{ companies: string[]; specs: string[] }>("/erp/mrp/filter-options"),
    staleTime: 1000 * 60 * 30,
  })
}
