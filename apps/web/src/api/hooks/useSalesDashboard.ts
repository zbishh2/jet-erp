import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type Granularity = "daily" | "monthly" | "weekly" | "yearly"

export interface SalesSummary {
  period: string
  totalSales: number
  totalMSF: number
  totalCost: number
  invoiceCount: number
}

export interface SalesByRep {
  repName: string | null
  totalSales: number
  totalMSF: number
  totalCost: number
}

export interface SalesByCustomer {
  customerName: string
  repName: string | null
  totalSales: number
  totalMSF: number
  totalCost: number
  invoiceCount: number
}

export interface SalesRep {
  contactId: number
  repName: string
}

export interface SalesBudget {
  id: string
  salesRep: string
  month: string
  budgetedDollars: number
  budgetedMsf: number
  budgetedContribution: number
}

export function useSalesSummary(startDate: string, endDate: string, granularity: Granularity = "monthly", rep?: string) {
  return useQuery({
    queryKey: ["sales", "summary", startDate, endDate, granularity, rep ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      if (rep) params.set("rep", rep)
      return apiFetch<{ data: SalesSummary[] }>(`/erp/sales/summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSalesByRep(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["sales", "by-rep", startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      return apiFetch<{ data: SalesByRep[] }>(`/erp/sales/by-rep?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSalesByCustomer(startDate: string, endDate: string, limit = 50) {
  return useQuery({
    queryKey: ["sales", "by-customer", startDate, endDate, limit],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, limit: String(limit) })
      return apiFetch<{ data: SalesByCustomer[] }>(`/erp/sales/by-customer?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export interface SalesDetailRow {
  invoiceDate: string
  invoiceNumber: string
  customerName: string
  repName: string | null
  totalSales: number
  totalMSF: number
  totalCost: number
}

export function useSalesDetail(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["sales", "detail", startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      return apiFetch<{ data: SalesDetailRow[] }>(`/erp/sales/detail?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSalesReps() {
  return useQuery({
    queryKey: ["sales", "reps"],
    queryFn: () => apiFetch<{ data: SalesRep[] }>("/erp/sales/reps"),
    staleTime: 1000 * 60 * 10,
  })
}

export function useSalesBudgets(year: string) {
  return useQuery({
    queryKey: ["sales", "budgets", year],
    queryFn: () => {
      const params = new URLSearchParams({ year })
      return apiFetch<{ data: SalesBudget[] }>(`/erp/sales/budgets?${params}`)
    },
    enabled: !!year,
    staleTime: 1000 * 60 * 10,
  })
}

export interface Holiday {
  id: string
  holidayDate: string
  name: string
}

export function useHolidays(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ["sales", "holidays", startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      return apiFetch<{ data: Holiday[] }>(`/erp/sales/holidays?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 30,
  })
}
