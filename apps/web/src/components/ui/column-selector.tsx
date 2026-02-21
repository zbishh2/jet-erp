import { Columns3 } from "lucide-react"
import { Button } from "./button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu"

export interface ColumnConfig {
  key: string
  label: string
  defaultVisible: boolean
}

interface ColumnSelectorProps {
  columns: ColumnConfig[]
  visibleKeys: string[]
  onChange: (visibleKeys: string[]) => void
}

export function ColumnSelector({ columns, visibleKeys, onChange }: ColumnSelectorProps) {
  const visibleSet = new Set(visibleKeys)

  const toggleColumn = (key: string) => {
    const newSet = new Set(visibleKeys)
    if (newSet.has(key)) {
      newSet.delete(key)
    } else {
      newSet.add(key)
    }
    onChange(Array.from(newSet))
  }

  const showAll = () => {
    onChange(columns.map(c => c.key))
  }

  const resetToDefault = () => {
    onChange(columns.filter(c => c.defaultVisible).map(c => c.key))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="mr-2 h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 max-h-80 overflow-y-auto">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.key}
            checked={visibleSet.has(column.key)}
            onCheckedChange={() => toggleColumn(column.key)}
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={showAll}>
          Show all
        </DropdownMenuItem>
        <DropdownMenuItem onClick={resetToDefault}>
          Reset to default
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
