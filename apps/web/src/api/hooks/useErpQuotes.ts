import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"
import type { CreateErpQuote, UpdateErpQuote } from "@jet-erp/shared"

// Response types
export interface ErpQuoteListItem {
  id: string
  quoteNumber: string
  customerId: number
  customerName: string
  status: string
  shippingMethod: string
  createdAt: string
  updatedAt: string
  version: number
}

export interface ErpQuoteLineItem {
  id: string
  quoteId: string
  lineNumber: number
  description: string | null
  quantity: number
  boxStyle: string | null
  length: number | null
  width: number | null
  depth: number | null
  boardGradeId: number | null
  boardGradeCode: string | null
  inkCoveragePercent: number
  isGlued: number
  costSnapshot: string | null
  pricePerM: number | null
  qtyPerHour: number | null
  createdAt: string
  updatedAt: string
}

export interface ErpQuoteDetail extends ErpQuoteListItem {
  shipToAddressId: number | null
  notes: string | null
  lines: ErpQuoteLineItem[]
}

interface ListResponse {
  data: ErpQuoteListItem[]
  page: number
  pageSize: number
  total: number
}

interface DetailResponse {
  data: ErpQuoteDetail
}

// Filters
export interface ErpQuoteListFilters {
  page?: number
  pageSize?: number
  status?: string
  search?: string
}

// Hooks

export function useErpQuotes(filters: ErpQuoteListFilters = {}) {
  const { page = 1, pageSize = 20, status, search } = filters

  return useQuery({
    queryKey: ["erp-quotes", { page, pageSize, status, search }],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))
      if (status) params.set("status", status)
      if (search) params.set("search", search)
      return apiFetch<ListResponse>(`/erp/quotes?${params}`)
    },
    placeholderData: keepPreviousData,
  })
}

export function useErpQuote(id: string | undefined) {
  return useQuery({
    queryKey: ["erp-quotes", id],
    queryFn: () => apiFetch<DetailResponse>(`/erp/quotes/${id}`),
    enabled: !!id,
  })
}

export function useCreateErpQuote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: CreateErpQuote) =>
      apiFetch<DetailResponse>("/erp/quotes", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp-quotes"] })
    },
  })
}

export function useUpdateErpQuote(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: UpdateErpQuote) =>
      apiFetch<DetailResponse>(`/erp/quotes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp-quotes"] })
    },
  })
}

export function useDeleteErpQuote() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/erp/quotes/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["erp-quotes"] })
    },
  })
}
