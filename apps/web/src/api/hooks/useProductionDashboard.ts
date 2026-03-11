import { useQuery } from "@tanstack/react-query"
import { apiFetch } from "@/api/client"

export type Granularity = "daily" | "monthly" | "weekly" | "yearly"

export interface QualitySummary {
  period: string
  producedSheets: number
  producedQty: number
  wasteSheets: number
  fedQty: number
}

export interface QualityDetail {
  weekStartDate: string
  feedbackDate: string
  jobNum: string
  lineNumber: number
  customerName: string
  specNumber: string
  reportedWaste: number
  prerunWaste: number
  producedSheets: number
  qualityPct: number
}

export interface QualityByMachine {
  machineName: string
  machineNumber: number
  producedSheets: number
  producedQty: number
  wasteSheets: number
  fedQty: number
}

export interface QualityByShift {
  shiftName: string
  producedSheets: number
  producedQty: number
  wasteSheets: number
  fedQty: number
}

export interface WasteByCategory {
  wasteCode: string
  wasteSheets: number
}

export interface SpeedSummary {
  period: string
  totalFedIn: number
  uptimeHours: number
  orderHours: number
  avgOptimumSpeed: number
}

export interface SpeedByMachine {
  machineName: string
  machineNumber: number
  totalFedIn: number
  uptimeHours: number
  orderHours: number
  optimumSpeed: number
}

export interface SpeedByShift {
  shiftName: string
  totalFedIn: number
  uptimeHours: number
}

export interface UptimeSummary {
  period: string
  orderHours: number
  setupHours: number
  downtimeOpen: number
  downtimeClosed: number
}

export interface UptimeByMachine {
  machineName: string
  machineNumber: number
  orderHours: number
  setupHours: number
  downtimeOpen: number
  downtimeClosed: number
}

export interface UptimeByShift {
  shiftName: string
  orderHours: number
  setupHours: number
  downtimeOpen: number
  downtimeClosed: number
}

export interface OeeSummary {
  period: string
  producedSheets: number
  wasteSheets: number
  speedFedIn: number
  speedUptimeHours: number
  avgOptimumSpeed: number
  orderHours: number
  setupHours: number
  downtimeOpen: number
  downtimeClosed: number
}

export interface OeeByMachine {
  machineName: string
  machineNumber: number
  producedSheets: number
  wasteSheets: number
  speedFedIn: number
  speedUptimeHours: number
  avgOptimumSpeed: number
  orderHours: number
  setupHours: number
  downtimeOpen: number
  downtimeClosed: number
}

export interface OeeByShift {
  shiftName: string
  producedSheets: number
  wasteSheets: number
  speedFedIn: number
  speedUptimeHours: number
  avgOptimumSpeed: number
  orderHours: number
  setupHours: number
  downtimeOpen: number
  downtimeClosed: number
}

export interface OeeDetail {
  feedbackDate: string
  lineNumber: number
  jobNum: string
  customerName: string
  specNumber: string
  uptimePct: number
  speedToOptimumPct: number
  qualityPct: number
  oeePct: number
  setupCount: number
  orderHours: number
}

export interface SpeedDetail {
  weekStartDate: string
  lineNumber: number
  feedbackDate: string
  jobNum: string
  customerName: string
  specNumber: string
  speedToOptimumPct: number
  speedToOptimumOrderPct: number
  speedSheetsPerHour: number
  speedSheetsPerOrderHour: number
  uptimeHours: number
  actualSpeed: number
  optimumRunSpeed: number
  orderHours: number
  uptimePct: number
}

export interface SpeedException {
  feedDate: string
  machineName: string
  machineNumber: number
  shiftName: string
  fedIn: number
  runHours: number
  actualSpeed: number
  optimumSpeed: number
}

export interface UptimeDetail {
  weekStartDate: string
  feedbackDate: string
  jobNum: string
  lineNumber: number
  customerName: string
  specNumber: string
  setupHours: number
  runHours: number
  downtimeHours: number
  orderHours: number
  uptimeHours: number
  setupPct: number
  uptimePct: number
  downtimePct: number
}

export interface DowntimeByReason {
  className: string
  downtimeHours: number
}

export interface Machine {
  machineNumber: number
  machineName: string
}

export interface Shift {
  shiftName: string
}

export interface ProductionDateLimits {
  minDate: string | null
  maxDate: string | null
}

export function useProductionDateLimits() {
  return useQuery({
    queryKey: ["production", "date-limits"],
    queryFn: () => apiFetch<{ data: ProductionDateLimits[] }>("/erp/production/date-limits"),
    staleTime: 1000 * 60 * 30,
  })
}

export function useQualitySummary(
  startDate: string,
  endDate: string,
  granularity: Granularity = "monthly",
  machine?: string,
  shift?: string
) {
  return useQuery({
    queryKey: ["production", "quality-summary", startDate, endDate, granularity, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: QualitySummary[] }>(`/erp/production/quality-summary?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useQualityByMachine(startDate: string, endDate: string, shift?: string) {
  return useQuery({
    queryKey: ["production", "quality-by-machine", startDate, endDate, shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: QualityByMachine[] }>(`/erp/production/quality-by-machine?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useQualityByShift(startDate: string, endDate: string, machine?: string) {
  return useQuery({
    queryKey: ["production", "quality-by-shift", startDate, endDate, machine ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      return apiFetch<{ data: QualityByShift[] }>(`/erp/production/quality-by-shift?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useQualityDetail(startDate: string, endDate: string, machine?: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "quality-detail", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: QualityDetail[] }>(`/erp/production/quality-detail?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useWasteByCategory(startDate: string, endDate: string, machine?: string, shift?: string) {
  return useQuery({
    queryKey: ["production", "waste-by-category", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: WasteByCategory[] }>(`/erp/production/waste-by-category?${params}`)
    },
    enabled: !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSpeedSummary(
  startDate: string,
  endDate: string,
  granularity: Granularity = "monthly",
  machine?: string,
  shift?: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["production", "speed-summary", startDate, endDate, granularity, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: SpeedSummary[] }>(`/erp/production/speed-summary?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSpeedByMachine(startDate: string, endDate: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "speed-by-machine", startDate, endDate, shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: SpeedByMachine[] }>(`/erp/production/speed-by-machine?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSpeedByShift(startDate: string, endDate: string, machine?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "speed-by-shift", startDate, endDate, machine ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      return apiFetch<{ data: SpeedByShift[] }>(`/erp/production/speed-by-shift?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUptimeSummary(
  startDate: string,
  endDate: string,
  granularity: Granularity = "monthly",
  machine?: string,
  shift?: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["production", "uptime-summary", startDate, endDate, granularity, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: UptimeSummary[] }>(`/erp/production/uptime-summary?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUptimeByMachine(startDate: string, endDate: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "uptime-by-machine", startDate, endDate, shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: UptimeByMachine[] }>(`/erp/production/uptime-by-machine?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUptimeByShift(startDate: string, endDate: string, machine?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "uptime-by-shift", startDate, endDate, machine ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      return apiFetch<{ data: UptimeByShift[] }>(`/erp/production/uptime-by-shift?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useOeeSummary(
  startDate: string,
  endDate: string,
  granularity: Granularity = "monthly",
  machine?: string,
  shift?: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["production", "oee-summary", startDate, endDate, granularity, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate, granularity })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: OeeSummary[] }>(`/erp/production/oee-summary?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useOeeByMachine(startDate: string, endDate: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "oee-by-machine", startDate, endDate, shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: OeeByMachine[] }>(`/erp/production/oee-by-machine?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useOeeByShift(startDate: string, endDate: string, machine?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "oee-by-shift", startDate, endDate, machine ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      return apiFetch<{ data: OeeByShift[] }>(`/erp/production/oee-by-shift?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useOeeDetail(startDate: string, endDate: string, machine?: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "oee-detail", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: OeeDetail[] }>(`/erp/production/oee-detail?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSpeedDetail(startDate: string, endDate: string, machine?: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "speed-detail", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: SpeedDetail[] }>(`/erp/production/speed-detail?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useSpeedExceptions(startDate: string, endDate: string, machine?: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "speed-exceptions", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: SpeedException[] }>(`/erp/production/speed-exceptions?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useUptimeDetail(startDate: string, endDate: string, machine?: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "uptime-detail", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: UptimeDetail[] }>(`/erp/production/uptime-detail?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useDowntimeByReason(startDate: string, endDate: string, machine?: string, shift?: string, enabled = true) {
  return useQuery({
    queryKey: ["production", "downtime-by-reason", startDate, endDate, machine ?? "all", shift ?? "all"],
    queryFn: () => {
      const params = new URLSearchParams({ startDate, endDate })
      if (machine) params.set("machine", machine)
      if (shift) params.set("shift", shift)
      return apiFetch<{ data: DowntimeByReason[] }>(`/erp/production/downtime-by-reason?${params}`)
    },
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,
  })
}

export function useMachines() {
  return useQuery({
    queryKey: ["production", "machines"],
    queryFn: () => apiFetch<{ data: Machine[] }>("/erp/production/machines"),
    staleTime: 1000 * 60 * 10,
  })
}

export function useShifts() {
  return useQuery({
    queryKey: ["production", "shifts"],
    queryFn: () => apiFetch<{ data: Shift[] }>("/erp/production/shifts"),
    staleTime: 1000 * 60 * 10,
  })
}
