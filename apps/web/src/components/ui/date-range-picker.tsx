import { useState } from "react"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { CalendarIcon } from "lucide-react"
import type { DateRange as DayPickerRange } from "react-day-picker"

interface DateRangePickerProps {
  startDate?: string
  endDate?: string
  onChange: (start: string, end: string) => void
  children?: React.ReactNode
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function DateRangePicker({ startDate, endDate, onChange, children }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<DayPickerRange | undefined>(() => {
    if (!startDate || !endDate) return undefined
    const [sy, sm, sd] = startDate.split("-").map(Number)
    const [ey, em, ed] = endDate.split("-").map(Number)
    return {
      from: new Date(sy, sm - 1, sd),
      to: new Date(ey, em - 1, ed),
    }
  })

  const handleSelect = (selected: DayPickerRange | undefined) => {
    setRange(selected)
    if (selected?.from && selected?.to) {
      onChange(toISO(selected.from), toISO(selected.to))
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <Button variant="outline" size="sm" className="h-7 px-2.5 text-xs gap-1">
            <CalendarIcon className="h-3.5 w-3.5" />
            Date Picker
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={range}
          onSelect={handleSelect}
          numberOfMonths={2}
          defaultMonth={range?.from}
        />
      </PopoverContent>
    </Popover>
  )
}
