import { Button } from "@/components/ui"

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canGoBack = page > 1
  const canGoForward = page < totalPages

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-foreground-secondary">
        Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={!canGoBack} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <span className="text-sm text-foreground-secondary">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={!canGoForward} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
