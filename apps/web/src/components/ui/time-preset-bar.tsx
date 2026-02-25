import { Button } from "@/components/ui/button"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { CalendarIcon } from "lucide-react"
import {
  getPresetsForGranularity,
  type Granularity,
  type TimeWindow,
  type DateLimits,
  type DateRange,
} from "@/lib/time-presets"

interface TimePresetBarProps {
  granularity: Granularity
  value: TimeWindow
  onChange: (window: TimeWindow) => void
  dateLimits?: DateLimits | null
  customRange?: DateRange | null
  onCustomRangeChange?: (start: string, end: string) => void
}

export function TimePresetBar({
  granularity,
  value,
  onChange,
  dateLimits,
  customRange,
  onCustomRangeChange,
}: TimePresetBarProps) {
  const presets = getPresetsForGranularity(granularity, dateLimits)

  return (
    <div className="flex items-center gap-1">
      {presets.map((preset) => (
        <Button
          key={preset.key}
          variant={value === preset.key ? "default" : "outline"}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => onChange(preset.key)}
        >
          {preset.label}
        </Button>
      ))}
      <DateRangePicker
        startDate={customRange?.startDate}
        endDate={customRange?.endDate}
        onChange={(start, end) => {
          onCustomRangeChange?.(start, end)
          onChange("custom")
        }}
      >
        <Button
          variant={value === "custom" ? "default" : "outline"}
          size="sm"
          className="h-7 px-2.5 text-xs gap-1"
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {value === "custom" && customRange
            ? `${customRange.startDate} – ${customRange.endDate}`
            : "Date Picker"}
        </Button>
      </DateRangePicker>
    </div>
  )
}
