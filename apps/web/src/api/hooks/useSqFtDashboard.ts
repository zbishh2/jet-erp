import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type SqFtGranularity = "daily" | "weekly" | "monthly" | "yearly"

export interface SqFtSummary {
  period: string
  sqFtEntry: number
  orderHours: number
  dayCount: number
}

export interface SqFtByLine {
  lineNumber: string
  sqFtEntry: number
  orderHours: number
}

export interface SqFtDetailRow {
  feedbackDate: string
  jobNumber: string
  customerName: string
  specNumber: string
  lineNumber: string
  sqFtEntry: number
  sqFtPerBox: number
  orderHours: number
}

export interface SqFtFilterOptions {
  lineNumbers: string[]
  customers: string[]
  specs: string[]
}

export interface SqFtDateLimits {
  minDate: string | null
  maxDate: string | null
}

function addFilters(params: URLSearchParams, line?: string, customer?: string, spec?: string) {
  if (line) params.set("line", line)
  if (customer) params.set("customer", customer)
  if (spec) params.set("spec", spec)
}

export function useSqFtDateLimits() {
  return useQuery({
    queryKey: ["sqft", "date-limits"],
    queryFn: () => apiFetch<{ data: SqFtDateLimits[] }>("/erp/sqft/date-limits"),
    staleTime: 1000 * 60 * 30,
  })
}

export function useSqFtSummary(
  startDate: string,
  endDate: string,
  granularity: SqFtGranularity = "weekly",
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["sqft", "summary", startDate, endDate, granularity, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: SqFtSummary[] }>(`/erp/sqft/summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSqFtByLine(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["sqft", "by-line", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: SqFtByLine[] }>(`/erp/sqft/by-line?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSqFtDetails(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["sqft", "details", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: SqFtDetailRow[] }>(`/erp/sqft/details?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSqFtFilterOptions(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["sqft", "filter-options", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: SqFtFilterOptions }>(`/erp/sqft/filter-options?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}
