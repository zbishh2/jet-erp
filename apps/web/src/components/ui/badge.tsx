import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-0",
  {
    variants: {
      variant: {
        default: "bg-accent/10 text-accent",
        secondary: "bg-[var(--color-status-draft-bg)] text-[var(--color-status-draft)]",
        destructive: "bg-[var(--color-status-cancelled-bg)] text-[var(--color-status-cancelled)]",
        outline: "border border-border text-foreground-secondary",
        success: "bg-[var(--color-status-closed-bg)] text-[var(--color-status-closed)]",
        warning: "bg-[var(--color-status-reviewed-bg)] text-[var(--color-status-reviewed)]",
        info: "bg-[var(--color-status-submitted-bg)] text-[var(--color-status-submitted)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
