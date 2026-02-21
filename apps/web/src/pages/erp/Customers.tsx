import { useState } from "react"
import { Search, ChevronLeft, ChevronRight } from "lucide-react"
import { useKiwiplanCustomers, useKiwiplanHealth } from "@/api/hooks/useKiwiplan"
import {
  Button,
  Input,
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui"

export default function Customers() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [searchInput, setSearchInput] = useState("")
  const pageSize = 20

  const healthQuery = useKiwiplanHealth()
  const customersQuery = useKiwiplanCustomers({ page, pageSize, search })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
    setPage(1)
  }

  // Show gateway status if not connected
  if (healthQuery.isError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Kiwiplan Customers</h1>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p className="font-medium">Gateway Unavailable</p>
          <p className="text-sm mt-1">Unable to connect to the Kiwiplan gateway. Please check the connection.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Kiwiplan Customers</h1>
        {healthQuery.data && (
          <Badge variant="outline" className="text-xs">
            Gateway: {healthQuery.data.status}
          </Badge>
        )}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {/* Table */}
      {customersQuery.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : customersQuery.isError ? (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p>Error loading customers</p>
        </div>
      ) : (
        <>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer #</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customersQuery.data?.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                      No customers found
                    </TableCell>
                  </TableRow>
                ) : (
                  customersQuery.data?.data.map((customer) => (
                    <TableRow key={customer.customerId}>
                      <TableCell className="font-mono">{customer.customerNumber}</TableCell>
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {customer.isCustomer === -1 && (
                            <Badge variant="secondary">Customer</Badge>
                          )}
                          {customer.isSupplier === -1 && (
                            <Badge variant="outline">Supplier</Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              Page {page}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!customersQuery.data?.data.length || customersQuery.data.data.length < pageSize}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
