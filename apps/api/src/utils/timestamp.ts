// Timestamp utilities for D1/SQLite
// All timestamps are stored as ISO8601 strings

export function now(): string {
  return new Date().toISOString()
}

export function toDateString(date: Date | string): string {
  if (typeof date === 'string') {
    return date.slice(0, 10) // YYYY-MM-DD
  }
  return date.toISOString().slice(0, 10)
}

export function toMonthString(date: Date | string): string {
  if (typeof date === 'string') {
    return date.slice(0, 7) // YYYY-MM
  }
  return date.toISOString().slice(0, 7)
}

export function parseTimestamp(timestamp: string | null): Date | null {
  if (!timestamp) return null
  return new Date(timestamp)
}
