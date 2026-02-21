import { useParams, useNavigate } from "react-router-dom"
import { ArrowLeft, Package } from "lucide-react"
import { useErpQuote } from "@/api/hooks/useErpQuotes"
import {
  Button,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui"

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-"
  try {
    return new Date(dateStr).toLocaleDateString()
  } catch {
    return dateStr
  }
}

function getStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status?.toLowerCase()) {
    case "accepted":
      return "default"
    case "sent":
      return "outline"
    case "draft":
      return "secondary"
    case "rejected":
    case "expired":
      return "destructive"
    default:
      return "outline"
  }
}

const fmt = (value: number | null, decimals = 2) =>
  value != null
    ? value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : "-"

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const quoteQuery = useErpQuote(id)

  if (quoteQuery.isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
  }

  if (quoteQuery.isError || !quoteQuery.data) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate("/erp/quotes")} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Quotes
        </Button>
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p>Error loading quote</p>
        </div>
      </div>
    )
  }

  const quote = quoteQuery.data.data

  return (
    <div className="p-6">
      <Button variant="ghost" onClick={() => navigate("/erp/quotes")} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Quotes
      </Button>

      {/* Quote Header */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{quote.quoteNumber}</CardTitle>
              <CardDescription>{quote.customerName}</CardDescription>
            </div>
            <Badge variant={getStatusVariant(quote.status)}>{quote.status}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Shipping</dt>
              <dd className="font-medium uppercase">{quote.shippingMethod}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="font-medium">{formatDate(quote.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="font-medium">{formatDate(quote.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="font-medium">{quote.version}</dd>
            </div>
          </dl>

          {quote.notes && (
            <div className="mt-4 pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{quote.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quote Lines */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Line Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!quote.lines || quote.lines.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No line items</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Style</TableHead>
                  <TableHead className="text-right">Dims (L x W x D)</TableHead>
                  <TableHead>Board</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price/M</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell>{line.lineNumber}</TableCell>
                    <TableCell>{line.description || "-"}</TableCell>
                    <TableCell className="font-mono">{line.boxStyle || "-"}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {line.length && line.width && line.depth
                        ? `${line.length} x ${line.width} x ${line.depth}`
                        : "-"}
                    </TableCell>
                    <TableCell className="font-mono">{line.boardGradeCode || "-"}</TableCell>
                    <TableCell className="text-right">{line.quantity.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">${fmt(line.pricePerM)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
