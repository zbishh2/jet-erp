import * as React from "react"
import { format } from "date-fns"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
]

interface MonthPickerProps {
  value?: string // YYYY-MM format
  onChange?: (value: string | undefined) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function MonthPicker({
  value,
  onChange,
  placeholder = "Pick a month",
  className,
  disabled,
}: MonthPickerProps) {
  const [open, setOpen] = React.useState(false)

  // Parse the YYYY-MM value
  const currentYear = value ? parseInt(value.split("-")[0]) : new Date().getFullYear()
  const currentMonth = value ? parseInt(value.split("-")[1]) - 1 : undefined

  const [viewYear, setViewYear] = React.useState(currentYear)

  // Reset view year when opening
  React.useEffect(() => {
    if (open) {
      setViewYear(currentYear)
    }
  }, [open, currentYear])

  const handleSelect = (monthIndex: number) => {
    const month = String(monthIndex + 1).padStart(2, "0")
    onChange?.(`${viewYear}-${month}`)
    setOpen(false)
  }

  const displayValue = value
    ? format(new Date(parseInt(value.split("-")[0]), parseInt(value.split("-")[1]) - 1), "MMM yyyy")
    : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal h-8",
            !value && "text-foreground-secondary",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue ? displayValue : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="space-y-3">
          {/* Year navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewYear(y => y - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">{viewYear}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewYear(y => y + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-2">
            {MONTHS.map((month, index) => {
              const isSelected = viewYear === currentYear && index === currentMonth
              return (
                <Button
                  key={month}
                  variant={isSelected ? "default" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => handleSelect(index)}
                >
                  {month}
                </Button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
