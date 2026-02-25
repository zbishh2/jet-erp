// ---------------------------------------------------------------------------
// Shared time-preset logic for all ERP dashboards
// ---------------------------------------------------------------------------

export type Granularity = "daily" | "weekly" | "monthly" | "yearly"

export type TimeWindow =
  | `year-${number}`
  | "last-3m" | "last-6m" | "last-12m"
  | "last-4w" | "last-12w" | "last-26w" | "weeks-ytd"
  | "last-7d" | "last-14d" | "last-30d"
  | "ytd"
  | "custom"

export interface DateRange {
  startDate: string
  endDate: string
}

export interface DateLimits {
  minDate: string | null
  maxDate: string | null
}

export interface Preset {
  key: TimeWindow
  label: string
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function formatDateISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

export function alignToMonday(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

export function parseISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function startOfQuarter(date: Date): Date {
  const month = date.getMonth()
  const quarterStartMonth = Math.floor(month / 3) * 3
  return new Date(date.getFullYear(), quarterStartMonth, 1)
}

// ---------------------------------------------------------------------------
// Preset definitions per granularity
// ---------------------------------------------------------------------------

export function getPresetsForGranularity(
  granularity: Granularity,
  dateLimits?: DateLimits | null
): Preset[] {
  switch (granularity) {
    case "yearly": {
      const now = new Date()
      const currentYear = now.getFullYear()
      const minYear = dateLimits?.minDate
        ? parseISODate(dateLimits.minDate).getFullYear()
        : currentYear - 3
      const years: Preset[] = []
      for (let y = minYear; y <= currentYear; y++) {
        years.push({ key: `year-${y}` as TimeWindow, label: String(y) })
      }
      return years
    }
    case "monthly":
      return [
        { key: "last-3m", label: "Last 3M" },
        { key: "last-6m", label: "Last 6M" },
        { key: "last-12m", label: "Last 12M" },
        { key: "ytd", label: "YTD" },
      ]
    case "weekly":
      return [
        { key: "last-4w", label: "Last 4W" },
        { key: "last-12w", label: "Last 12W" },
        { key: "last-26w", label: "Last 26W" },
        { key: "weeks-ytd", label: "Weeks YTD" },
      ]
    case "daily":
      return [
        { key: "last-7d", label: "Last 7D" },
        { key: "last-14d", label: "Last 14D" },
        { key: "last-30d", label: "Last 30D" },
        { key: "ytd", label: "YTD" },
      ]
  }
}

export function getDefaultPreset(granularity: Granularity): TimeWindow {
  switch (granularity) {
    case "yearly":
      return `year-${new Date().getFullYear()}` as TimeWindow
    case "monthly":
      return "last-6m"
    case "weekly":
      return "last-12w"
    case "daily":
      return "last-14d"
  }
}

// ---------------------------------------------------------------------------
// Time-window → date range resolver
// ---------------------------------------------------------------------------

export function getTimeWindowRange(
  window: TimeWindow,
  dateLimits?: DateLimits | null,
  customRange?: DateRange | null
): DateRange {
  const now = new Date()
  const maxDataDate = dateLimits?.maxDate ? parseISODate(dateLimits.maxDate) : null
  const dataEndExclusive = maxDataDate
    ? formatDateISO(addDays(maxDataDate, 1))
    : formatDateISO(addDays(now, 1))

  // Custom date-picker range
  if (window === "custom" && customRange) {
    return { startDate: customRange.startDate, endDate: customRange.endDate }
  }

  // Yearly: year-NNNN
  const yearMatch = window.match(/^year-(\d{4})$/)
  if (yearMatch) {
    const y = Number(yearMatch[1])
    return { startDate: `${y}-01-01`, endDate: `${y + 1}-01-01` }
  }

  // Weekly presets
  if (window === "last-4w" || window === "last-12w" || window === "last-26w" || window === "weeks-ytd") {
    const thisMonday = alignToMonday(now)
    if (window === "last-4w") return { startDate: formatDateISO(addDays(thisMonday, -28)), endDate: dataEndExclusive }
    if (window === "last-12w") return { startDate: formatDateISO(addDays(thisMonday, -84)), endDate: dataEndExclusive }
    if (window === "last-26w") return { startDate: formatDateISO(addDays(thisMonday, -182)), endDate: dataEndExclusive }
    // weeks-ytd
    const jan1 = new Date(now.getFullYear(), 0, 1)
    return { startDate: formatDateISO(alignToMonday(jan1)), endDate: dataEndExclusive }
  }

  // Monthly presets
  if (window === "last-3m") return { startDate: formatDateISO(addDays(now, -91)), endDate: dataEndExclusive }
  if (window === "last-6m") return { startDate: formatDateISO(addDays(now, -182)), endDate: dataEndExclusive }
  if (window === "last-12m") return { startDate: formatDateISO(addDays(now, -365)), endDate: dataEndExclusive }

  // Daily presets
  if (window === "last-7d") return { startDate: formatDateISO(addDays(now, -7)), endDate: dataEndExclusive }
  if (window === "last-14d") return { startDate: formatDateISO(addDays(now, -14)), endDate: dataEndExclusive }
  if (window === "last-30d") return { startDate: formatDateISO(addDays(now, -30)), endDate: dataEndExclusive }

  // YTD (shared)
  return { startDate: `${now.getFullYear()}-01-01`, endDate: dataEndExclusive }
}

/** Check if a persisted TimeWindow value is valid for the given granularity */
export function isValidPreset(window: string, granularity: Granularity): boolean {
  if (window === "custom") return true
  const presets = getPresetsForGranularity(granularity)
  return presets.some((p) => p.key === window)
}
