import { useState, useRef, useCallback, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Play, Copy, Download, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import { apiFetch } from "@/api/client"

const DEFAULT_SQL = `SELECT TOP 10 * FROM espInvoice ORDER BY transactiondate DESC`

interface QueryResult {
  data: Record<string, unknown>[]
}

export default function SqlExplorer() {
  const [sql, setSql] = useState(DEFAULT_SQL)
  const [results, setResults] = useState<Record<string, unknown>[] | null>(null)
  const [columns, setColumns] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [executionTime, setExecutionTime] = useState<number | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const runQuery = useCallback(async () => {
    const trimmed = sql.trim()
    if (!trimmed) return

    setIsLoading(true)
    setError(null)
    setResults(null)
    setColumns([])
    setExecutionTime(null)

    const startTime = performance.now()

    try {
      const result = await apiFetch<QueryResult>("/erp/sales/query", {
        method: "POST",
        body: JSON.stringify({ sql: trimmed }),
      })

      const elapsed = performance.now() - startTime
      setExecutionTime(elapsed)

      const rows = result.data ?? []
      setResults(rows)

      if (rows.length > 0) {
        setColumns(Object.keys(rows[0]))
      }
    } catch (err) {
      const elapsed = performance.now() - startTime
      setExecutionTime(elapsed)

      if (err instanceof Error) {
        // Try to extract a meaningful message
        const apiErr = err as { message?: string; body?: { error?: string } }
        setError(apiErr.body?.error || apiErr.message || "Query failed")
      } else {
        setError("An unexpected error occurred")
      }
    } finally {
      setIsLoading(false)
    }
  }, [sql])

  // Ctrl+Enter keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault()
        runQuery()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [runQuery])

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return "NULL"
    if (typeof value === "object") return JSON.stringify(value)
    return String(value)
  }

  const exportCsv = useCallback(() => {
    if (!results || results.length === 0) return

    const escape = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }

    const header = columns.map(escape).join(",")
    const rows = results.map((row) =>
      columns.map((col) => escape(formatCellValue(row[col]))).join(",")
    )
    const csv = [header, ...rows].join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `query-results-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [results, columns])

  const copyAsCsv = useCallback(() => {
    if (!results || results.length === 0) return

    const escape = (val: string) => {
      if (val.includes(",") || val.includes('"') || val.includes("\n")) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    }

    const header = columns.map(escape).join(",")
    const rows = results.map((row) =>
      columns.map((col) => escape(formatCellValue(row[col]))).join(",")
    )
    const csv = [header, ...rows].join("\n")

    navigator.clipboard.writeText(csv).then(() => {
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    })
  }, [results, columns])

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SQL Explorer</h1>
          <p className="text-sm text-foreground-secondary mt-1">
            Run read-only queries against the ESP (Kiwiplan) database
          </p>
        </div>
      </div>

      {/* Query Input */}
      <Card className="bg-background-secondary">
        <CardContent className="p-4 space-y-3">
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            className="w-full min-h-[160px] rounded-md border border-border bg-[#1e1e2e] text-[#cdd6f4] px-4 py-3 font-mono text-sm leading-relaxed placeholder:text-foreground-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent resize-y"
            placeholder="Enter SQL query..."
            spellCheck={false}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-foreground-tertiary">
              Ctrl+Enter to run. Only SELECT and WITH statements are allowed.
            </p>
            <Button onClick={runQuery} disabled={isLoading || !sql.trim()}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run Query
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-rose-500/50 bg-rose-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-rose-500">Query Error</p>
              <pre className="mt-1 text-sm text-rose-400 whitespace-pre-wrap font-mono">{error}</pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results !== null && (
        <Card className="bg-background-secondary">
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-4">
              <CardTitle className="text-base">Results</CardTitle>
              <div className="flex items-center gap-3 text-xs text-foreground-secondary">
                <span>{results.length.toLocaleString()} row{results.length !== 1 ? "s" : ""}</span>
                {executionTime !== null && (
                  <span>{executionTime < 1000 ? `${Math.round(executionTime)}ms` : `${(executionTime / 1000).toFixed(2)}s`}</span>
                )}
              </div>
            </div>
            {results.length > 0 && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={copyAsCsv}>
                  {copyFeedback ? (
                    <CheckCircle2 className="h-4 w-4 mr-1.5 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1.5" />
                  )}
                  {copyFeedback ? "Copied" : "Copy CSV"}
                </Button>
                <Button variant="ghost" size="sm" onClick={exportCsv}>
                  <Download className="h-4 w-4 mr-1.5" />
                  Download CSV
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {results.length === 0 ? (
              <div className="py-12 text-center text-foreground-secondary text-sm">
                Query returned no results
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columns.map((col) => (
                        <TableHead key={col} className="whitespace-nowrap">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((row, i) => (
                      <TableRow key={i}>
                        {columns.map((col) => (
                          <TableCell key={col} className="whitespace-nowrap font-mono text-xs max-w-[300px] truncate">
                            <span className={row[col] === null ? "text-foreground-tertiary italic" : ""}>
                              {formatCellValue(row[col])}
                            </span>
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
