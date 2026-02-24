import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type CostVarianceGranularity = "daily" | "weekly" | "monthly" | "yearly"

export interface CostVarianceSummary {
  period: string
  estMaterialCost: number
  estLaborCost: number
  estFreightCost: number
  actMaterialCost: number
  actLaborCost: number
  actFreightCost: number
  orderHours: number
  uptimeHours: number
  estimatedHours: number
}

export interface CostVarianceDetailRow {
  feedbackDate: string
  jobNumber: string
  customerName: string
  specNumber: string
  lineNumber: string
  estMaterialCost: number
  estLaborCost: number
  estFreightCost: number
  actMaterialCost: number
  actLaborCost: number
  actFreightCost: number
  orderHours: number
  uptimeHours: number
  estimatedHours: number
  adjQty: number
  stdRunRate: number
  setupMins: number
}

export interface CostVarianceFilterOptions {
  lineNumbers: string[]
  customers: string[]
  specs: string[]
}

export interface CostVarianceDateLimits {
  minDate: string | null
  maxDate: string | null
}

function addFilters(params: URLSearchParams, line?: string, customer?: string, spec?: string) {
  if (line) params.set("line", line)
  if (customer) params.set("customer", customer)
  if (spec) params.set("spec", spec)
}

export function useCostVarianceDateLimits() {
  return useQuery({
    queryKey: ["cost-variance", "date-limits"],
    queryFn: () => apiFetch<{ data: CostVarianceDateLimits[] }>("/erp/cost-variance/date-limits"),
    staleTime: 1000 * 60 * 30,
  })
}

export function useCostVarianceSummary(
  startDate: string,
  endDate: string,
  granularity: CostVarianceGranularity = "daily",
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["cost-variance", "summary", startDate, endDate, granularity, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: CostVarianceSummary[] }>(`/erp/cost-variance/summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCostVarianceDetails(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["cost-variance", "details", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: CostVarianceDetailRow[] }>(`/erp/cost-variance/details?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useCostVarianceFilterOptions(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["cost-variance", "filter-options", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: CostVarianceFilterOptions }>(`/erp/cost-variance/filter-options?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}
