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
}

export interface InvoiceCostVarianceFilterOptions {
  customers: string[]
  specs: string[]
}

export interface InvoiceCostVarianceDateLimits {
  minDate: string | null
  maxDate: string | null
}

function addFilters(params: URLSearchParams, customer?: string, spec?: string) {
  if (customer) params.set("customer", customer)
  if (spec) params.set("spec", spec)
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
  spec?: string
) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "summary", startDate, endDate, granularity, customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      addFilters(params, customer, spec)
      return apiFetch<{ data: InvoiceCostVarianceSummary[] }>(`/erp/invoice-cost-variance/summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useInvoiceCostVarianceDetails(
  startDate: string,
  endDate: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "details", startDate, endDate, customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, customer, spec)
      return apiFetch<{ data: InvoiceCostVarianceDetailRow[] }>(`/erp/invoice-cost-variance/details?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useInvoiceCostVarianceFilterOptions(
  startDate: string,
  endDate: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["invoice-cost-variance", "filter-options", startDate, endDate, customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, customer, spec)
      return apiFetch<{ data: InvoiceCostVarianceFilterOptions }>(`/erp/invoice-cost-variance/filter-options?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}
