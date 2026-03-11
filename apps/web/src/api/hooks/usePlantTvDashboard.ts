import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiFetch } from "../client"

// ── Types ─────────────────────────────────────────────────────────────

export interface TvDataRow {
  feedbackDate: string
  lineNumber: number
  lineName: string
  shiftName: string
  totalSheetsFed: number
  totalOrderHours: number
  sheetsPerOrderHour: number
}

export interface TvGoal {
  id: string
  machine: number
  pct85: number
  pct90: number
  pct100: number
  pct112: number
}

// ── Hooks ─────────────────────────────────────────────────────────────

export function useTvData(startDate: string, endDate: string, enabled = true) {
  return useQuery({
    queryKey: ["plant-tv", "data", startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      return apiFetch<{ rows: TvDataRow[] }>(`/erp/plant-tv/data?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
    refetchInterval: 1000 * 60 * 5, // Auto-refresh every 5 minutes
    refetchIntervalInBackground: true, // Keep refreshing even when tab is unfocused (TV displays)
  })
}

export function useTvShifts() {
  return useQuery({
    queryKey: ["plant-tv", "shifts"],
    queryFn: () => apiFetch<{ shifts: string[] }>("/erp/plant-tv/shifts"),
    staleTime: 1000 * 60 * 30,
  })
}

export function useTvGoals() {
  return useQuery({
    queryKey: ["plant-tv", "goals"],
    queryFn: () => apiFetch<{ goals: TvGoal[] }>("/erp/plant-tv/goals"),
    staleTime: 1000 * 60 * 10,
  })
}

export function useUpdateTvGoals() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (goals: Array<{ machine: number; pct85: number; pct90: number; pct100: number; pct112: number }>) =>
      apiFetch<{ goals: TvGoal[] }>("/erp/plant-tv/goals", {
        method: "PUT",
        body: JSON.stringify({ goals }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plant-tv", "goals"] })
    },
  })
}
