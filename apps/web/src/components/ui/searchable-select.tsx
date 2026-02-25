import { useState, useMemo } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChevronDown, Search } from "lucide-react"

export interface SearchableSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: string[]
  placeholder: string
  searchPlaceholder: string
  width?: string
  popoverWidth?: string
  triggerClassName?: string
  /** Map option value → display label (for cases like machineNumber → machineName) */
  getLabel?: (value: string) => string
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  width = "w-[160px]",
  popoverWidth,
  triggerClassName,
  getLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const filtered = useMemo(
    () =>
      options.filter(
        (o) =>
          !search ||
          (getLabel ? getLabel(o) : o).toLowerCase().includes(search.toLowerCase())
      ),
    [options, search, getLabel]
  )

  const displayValue =
    value === "all" ? placeholder : getLabel ? getLabel(value) : value

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`${width} h-8 text-xs justify-between font-normal ${triggerClassName ?? ""}`}
        >
          <span className="truncate">{displayValue}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`${popoverWidth ?? width} p-2`} align="start">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
        <div className="max-h-[200px] overflow-y-auto space-y-0.5">
          <button
            className={`w-full text-left text-xs px-2 py-1 rounded hover:bg-background-hover ${value === "all" ? "bg-background-selected font-medium" : ""}`}
            onClick={() => {
              onValueChange("all")
              setSearch("")
              setOpen(false)
            }}
          >
            {placeholder}
          </button>
          {filtered.map((o) => (
            <button
              key={o}
              className={`w-full text-left text-xs px-2 py-1 rounded hover:bg-background-hover ${value === o ? "bg-background-selected font-medium" : ""}`}
              onClick={() => {
                onValueChange(o)
                setSearch("")
                setOpen(false)
              }}
            >
              {getLabel ? getLabel(o) : o}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
