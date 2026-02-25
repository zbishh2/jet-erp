import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type MrpGranularity = "day" | "week" | "2week" | "month"
export type HealthState = "good" | "adequate" | "belowMin" | "shortage"
export type ValueMode = "qty" | "cost" | "price"

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
  shortageDate: string | null
  belowMinDate: string | null
  hasPastDues: boolean
  buckets: SpecBucket[]
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
  kpis: MrpKpis
}

export interface HealthSummaryRow {
  label: string
  date: string
  good: number
  adequate: number
  belowMin: number
  shortage: number
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
  filters: string[]
) {
  return useQuery({
    queryKey: ["mrp", "projection", granularity, horizon, company, spec, filters.join(",")],
    queryFn: () => {
      const params = new URLSearchParams({
        granularity,
        horizon: String(horizon),
      })
      if (company && company !== "all") params.set("company", company)
      if (spec) params.set("spec", spec)
      if (filters.length > 0) params.set("filter", filters.join(","))
      return apiFetch<MrpProjectionResponse>(`/erp/mrp/projection?${params}`)
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useMrpHealthSummary(
  granularity: MrpGranularity,
  horizon: number,
  company: string,
  spec: string
) {
  return useQuery({
    queryKey: ["mrp", "health-summary", granularity, horizon, company, spec],
    queryFn: () => {
      const params = new URLSearchParams({
        granularity,
        horizon: String(horizon),
      })
      if (company && company !== "all") params.set("company", company)
      if (spec) params.set("spec", spec)
      return apiFetch<{ data: HealthSummaryRow[] }>(`/erp/mrp/health-summary?${params}`)
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
    queryFn: () => apiFetch<{ companies: string[] }>("/erp/mrp/filter-options"),
    staleTime: 1000 * 60 * 30,
  })
}
