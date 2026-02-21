import { useRef, useState, useEffect } from "react"
import {
  ChevronDown,
  Check,
  ClipboardCheck,
  Wrench,
  Package,
  Settings,
  Lightbulb,
  Calculator,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useModule } from "@/contexts/ModuleContext"

// Map module icon strings to Lucide components
const iconMap: Record<string, LucideIcon> = {
  ClipboardCheck: ClipboardCheck,
  Wrench: Wrench,
  Package: Package,
  Settings: Settings,
  Lightbulb: Lightbulb,
  Calculator: Calculator,
}

function getModuleIcon(iconName: string | null): LucideIcon {
  if (iconName && iconMap[iconName]) {
    return iconMap[iconName]
  }
  return Package // default icon
}

export function ModuleSwitcher() {
  const { currentModule, modules, isSingleModule, switchModule } = useModule()
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [])

  const handleSelect = (moduleCode: string) => {
    switchModule(moduleCode)
    setIsOpen(false)
  }

  // Don't render if no modules or only one module
  if (modules.length === 0) {
    return null
  }

  const CurrentIcon = currentModule ? getModuleIcon(currentModule.icon) : Package

  // Don't show switcher UI for single module orgs
  if (isSingleModule) {
    return (
      <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] font-medium text-foreground-secondary">
        <CurrentIcon className="h-4 w-4" />
        <span className="truncate">{currentModule?.name ?? "Loading..."}</span>
      </div>
    )
  }

  return (
    <div className="relative w-full" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] font-medium text-foreground-secondary hover:bg-background-hover hover:text-foreground"
        title="Switch module"
      >
        <CurrentIcon className="h-4 w-4" />
        <span className="truncate">{currentModule?.name ?? "Select module..."}</span>
        <ChevronDown className={cn("ml-auto h-4 w-4 text-foreground-tertiary transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-20 mt-2 w-full space-y-0.5 rounded-lg border border-border bg-background-hover p-1 shadow-2xl">
          {modules.map((mod) => {
            const ModIcon = getModuleIcon(mod.icon)
            return (
              <button
                key={mod.code}
                type="button"
                onClick={() => handleSelect(mod.code)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
                  mod.code === currentModule?.code
                    ? "bg-background-selected text-foreground"
                    : "text-foreground hover:bg-background"
                )}
              >
                <ModIcon className="h-4 w-4" />
                <span className="truncate flex-1">{mod.name}</span>
                {mod.code === currentModule?.code && (
                  <Check className="h-4 w-4 text-accent" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
