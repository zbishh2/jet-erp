import { useState, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Plus, Search, ChevronLeft, ChevronRight, Trash2, MoreHorizontal } from "lucide-react"
import { toast } from "sonner"
import { useErpQuotes, useDeleteErpQuote } from "@/api/hooks/useErpQuotes"
import {
  Button,
  Badge,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Checkbox,
} from "@/components/ui"

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
]

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" {
  switch (status?.toLowerCase()) {
    case "accepted":
      return "success"
    case "sent":
      return "info"
    case "draft":
      return "secondary"
    case "rejected":
    case "expired":
      return "destructive"
    default:
      return "secondary"
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-"
  try {
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return dateStr
  }
}

export default function Quotes() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Get filters from URL
  const search = searchParams.get("search") || ""
  const statusFilter = searchParams.get("status") || "all"
  const page = parseInt(searchParams.get("page") || "1", 10)
  const pageSize = 20

  // Local search input state
  const [searchInput, setSearchInput] = useState(search)

  const quotesQuery = useErpQuotes({
    page,
    pageSize,
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  })
  const deleteQuote = useDeleteErpQuote()

  const quotes = quotesQuery.data?.data ?? []
  const total = quotesQuery.data?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  // Update URL params helper
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "" || (key === "status" && value === "all") || (key === "page" && value === "1")) {
        newParams.delete(key)
      } else {
        newParams.set(key, value)
      }
    })
    setSearchParams(newParams, { replace: true })
  }, [searchParams, setSearchParams])

  const handleSearch = () => {
    updateParams({ search: searchInput, page: null })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch()
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === quotes.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(quotes.map(q => q.id)))
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    setDeleting(true)
    try {
      const results = await Promise.all(
        Array.from(selectedIds).map(async (id) => {
          try {
            await deleteQuote.mutateAsync(id)
            return { ok: true }
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : "Delete failed" }
          }
        })
      )
      const failed = results.filter(r => !r.ok)
      const succeeded = results.filter(r => r.ok).length

      if (failed.length > 0 && succeeded === 0) {
        toast.error(failed[0].message || "Failed to delete quotes")
      } else if (failed.length > 0) {
        toast.error(`Deleted ${succeeded}, but ${failed.length} failed: ${failed[0].message}`)
      } else {
        toast.success(`Deleted ${succeeded} quote(s)`)
      }
      setSelectedIds(new Set())
    } catch {
      toast.error("Failed to delete quotes")
    } finally {
      setDeleting(false)
      setDeleteDialogOpen(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Sticky Header - NO border */}
      <div className="sticky top-0 z-10 bg-background -mx-6 -mt-6 px-6">
        <div className="py-2 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button onClick={() => navigate("/erp/quotes/new")}>
                <Plus className="mr-2 h-4 w-4" />
                New Quote
              </Button>
              <Button
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={selectedIds.size === 0}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
                {selectedIds.size > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {selectedIds.size}
                  </Badge>
                )}
              </Button>
            </div>
            <div className="text-right">
              <h1 className="text-xl font-semibold">Quotes</h1>
              <p className="text-sm text-muted-foreground">Estimating</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Row - NO border */}
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
            <Input
              placeholder="Search quotes or customers..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-9"
            />
          </div>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(value) => updateParams({ status: value, page: null })}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Search Button */}
          <Button variant="outline" onClick={handleSearch}>
            Search
          </Button>
        </div>
      </div>

      {/* Results - NO border wrapper */}
      <div>
        {quotesQuery.isLoading ? (
          <div className="p-8 text-center text-foreground-secondary">Loading...</div>
        ) : quotesQuery.isError ? (
          <div className="p-8 text-center text-red-500">Error loading quotes</div>
        ) : quotes.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-foreground-secondary mb-4">No quotes found</p>
            <Button onClick={() => navigate("/erp/quotes/new")}>
              <Plus className="mr-2 h-4 w-4" />
              Create your first quote
            </Button>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={quotes.length > 0 && selectedIds.size === quotes.length}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableHead>
                  <TableHead>Quote #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Shipping</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotes.map((quote) => (
                  <TableRow
                    key={quote.id}
                    className={`cursor-pointer h-8 ${selectedIds.has(quote.id) ? "bg-background-selected" : ""}`}
                    onClick={() => navigate(`/erp/quotes/${quote.id}`)}
                  >
                    <TableCell className="py-0.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(quote.id)}
                        onCheckedChange={() => toggleSelect(quote.id)}
                        aria-label={`Select ${quote.quoteNumber}`}
                      />
                    </TableCell>
                    <TableCell className="py-0.5 font-medium text-sm font-mono">{quote.quoteNumber}</TableCell>
                    <TableCell className="py-0.5 text-sm">{quote.customerName || "-"}</TableCell>
                    <TableCell className="py-0.5 text-xs uppercase text-sm">{quote.shippingMethod}</TableCell>
                    <TableCell className="py-0.5 text-sm">{formatDate(quote.createdAt)}</TableCell>
                    <TableCell className="py-0.5 text-sm">{formatDate(quote.updatedAt)}</TableCell>
                    <TableCell className="py-0.5">
                      <Badge variant={getStatusBadgeVariant(quote.status)} className="text-xs">
                        {quote.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-0.5">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); navigate(`/erp/quotes/${quote.id}`) }}>
                            Open
                          </DropdownMenuItem>
                          {quote.status === "draft" && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedIds(new Set([quote.id]))
                                setDeleteDialogOpen(true)
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination - ALWAYS show */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm text-foreground-secondary">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} results
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => updateParams({ page: String(page - 1) })}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm text-foreground-secondary">
                  Page {page} of {Math.max(1, totalPages)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => updateParams({ page: String(page + 1) })}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quotes</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} quote{selectedIds.size > 1 ? "s" : ""}? Only draft quotes can be deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
