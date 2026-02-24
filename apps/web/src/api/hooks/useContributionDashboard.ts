import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type ContributionGranularity = "daily" | "weekly" | "monthly" | "yearly"

export interface ContributionSummary {
  period: string
  calculatedValue: number
  contribution: number
  orderHours: number
  avgContributionPerOrderHour: number | null
  contributionPerHourRowCount: number
  contributionPerOrderHour: number | null
  contributionPct: number | null
  dayCount: number
}

export interface ContributionByLine {
  lineNumber: string
  calculatedValue: number
  contribution: number
  orderHours: number
  contributionPerOrderHour: number | null
  contributionPct: number | null
}

export interface ContributionDetailRow {
  feedbackDate: string
  jobNumber: string
  customerName: string
  specNumber: string
  lineNumber: string
  calculatedValue: number
  estimatedFullCost: number
  contribution: number
  orderHours: number
  contributionPerOrderHour: number | null
  contributionPct: number | null
}

export interface ContributionFilterOptions {
  lineNumbers: string[]
  customers: string[]
  specs: string[]
}

export interface ContributionDateLimits {
  minDate: string | null
  maxDate: string | null
}

function addFilters(params: URLSearchParams, line?: string, customer?: string, spec?: string) {
  if (line) params.set("line", line)
  if (customer) params.set("customer", customer)
  if (spec) params.set("spec", spec)
}

export function useContributionDateLimits() {
  return useQuery({
    queryKey: ["contribution", "date-limits"],
    queryFn: () => apiFetch<{ data: ContributionDateLimits[] }>("/erp/contribution/date-limits"),
    staleTime: 1000 * 60 * 30,
  })
}

export function useContributionSummary(
  startDate: string,
  endDate: string,
  granularity: ContributionGranularity = "weekly",
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["contribution", "summary", startDate, endDate, granularity, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: ContributionSummary[] }>(`/erp/contribution/summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useContributionByLine(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["contribution", "by-line", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: ContributionByLine[] }>(`/erp/contribution/by-line?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useContributionDetails(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["contribution", "details", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: ContributionDetailRow[] }>(`/erp/contribution/details?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useContributionFilterOptions(
  startDate: string,
  endDate: string,
  line?: string,
  customer?: string,
  spec?: string
) {
  return useQuery({
    queryKey: ["contribution", "filter-options", startDate, endDate, line ?? "all", customer ?? "all", spec ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      addFilters(params, line, customer, spec)
      return apiFetch<{ data: ContributionFilterOptions }>(`/erp/contribution/filter-options?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}
