import { useRef, useState, useEffect } from "react"
import { Building2, ChevronDown, Check, Star, Shield } from "lucide-react"
import { cn } from "@/lib/utils"
import { useOrg } from "@/contexts/OrgContext"

export function OrgSwitcher() {
  const { currentOrg, organizations, isSingleOrg, switchOrg } = useOrg()
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

  const handleSelect = (orgId: string) => {
    switchOrg(orgId)
    setIsOpen(false)
  }

  // Don't show switcher UI for single org users
  if (isSingleOrg) {
    return (
      <div className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] font-semibold text-foreground">
        <Building2 className="h-4 w-4" />
        <span className="truncate">{currentOrg?.name ?? "Loading..."}</span>
      </div>
    )
  }

  return (
    <div className="relative w-full" ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] font-semibold text-foreground hover:bg-background-hover"
        title="Switch organization"
      >
        <Building2 className="h-4 w-4" />
        <span className="truncate">{currentOrg?.name ?? "Select org..."}</span>
        <ChevronDown className={cn("ml-auto h-4 w-4 text-foreground-secondary transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-20 mt-2 w-full space-y-0.5 rounded-lg border border-border bg-background-hover p-1 shadow-2xl">
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => handleSelect(org.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium transition-colors",
                org.id === currentOrg?.id
                  ? "bg-background-selected text-foreground"
                  : "text-foreground hover:bg-background"
              )}
            >
              <span className="truncate flex-1">{org.name}</span>
              {org.isMember === false && (
                <span title="Platform admin access">
                  <Shield className="h-3 w-3 text-amber-500" aria-label="Platform admin access" />
                </span>
              )}
              {org.isDefault && (
                <Star className="h-3 w-3 text-foreground-tertiary" aria-label="Default organization" />
              )}
              {org.id === currentOrg?.id && (
                <Check className="h-4 w-4 text-accent" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
