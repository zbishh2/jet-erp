import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import {
  Search,
  Loader2,
  Square,
  Trash2,
  Save,
  ChevronDown,
  ChevronRight,
  Database,
  AlertCircle,
  ArrowLeft,
  Clock,
  DollarSign,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  useCostAnalyses,
  useInvestigation,
  useSaveCostAnalysis,
  useDeleteCostAnalysis,
  type CostAnalysisRecord,
  type ToolCall,
} from '@/api/hooks/useCostAnalysis'

// ---------- Tool Call Display ----------

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isLoading = !toolCall.result && !toolCall.isError

  let rows: Record<string, unknown>[] | null = null
  if (toolCall.result && !toolCall.isError) {
    try {
      const jsonStart = toolCall.result.indexOf('[\n')
      if (jsonStart >= 0) {
        const jsonEnd = toolCall.result.lastIndexOf(']')
        if (jsonEnd > jsonStart) {
          const parsed = JSON.parse(toolCall.result.slice(jsonStart, jsonEnd + 1))
          if (Array.isArray(parsed) && parsed.length > 0) {
            rows = parsed
          }
        }
      }
    } catch { /* */ }
  }

  const sql = toolCall.input?.sql as string | undefined
  const database = toolCall.input?.database as string | undefined

  return (
    <div className="my-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-xs overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 hover:bg-[var(--color-bg-hover)] transition-colors text-left"
      >
        {isLoading ? (
          <Loader2 className="h-3 w-3 animate-spin text-[var(--color-accent)]" />
        ) : toolCall.isError ? (
          <AlertCircle className="h-3 w-3 text-rose-500" />
        ) : (
          <Database className="h-3 w-3 text-[var(--color-accent)]" />
        )}
        <span className="font-medium text-[var(--color-text)]">
          {isLoading ? 'Running query' : toolCall.isError ? 'Query error' : 'SQL query'}
        </span>
        {database && (
          <span className="text-[var(--color-text-tertiary)] uppercase">[{database}]</span>
        )}
        <span className="ml-auto">
          {isExpanded ? (
            <ChevronDown className="h-3 w-3 text-[var(--color-text-tertiary)]" />
          ) : (
            <ChevronRight className="h-3 w-3 text-[var(--color-text-tertiary)]" />
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-[var(--color-border)]">
          {sql && (
            <div className="px-2.5 py-2 bg-[var(--color-bg-secondary)]">
              <pre className="whitespace-pre-wrap break-all text-[var(--color-text-secondary)] font-mono text-[10px] leading-relaxed">
                {sql}
              </pre>
            </div>
          )}
          {toolCall.isError && toolCall.result && (
            <div className="px-2.5 py-2 text-rose-500">{toolCall.result}</div>
          )}
          {rows && (
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                    {Object.keys(rows[0]).map((col) => (
                      <th key={col} className="px-2 py-1 text-left font-medium text-[var(--color-text-secondary)] whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b border-[var(--color-border)] last:border-0">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-2 py-1 text-[var(--color-text)] whitespace-nowrap">
                          {val == null ? '' : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!toolCall.isError && toolCall.result && !rows && (
            <div className="px-2.5 py-2 text-[var(--color-text-secondary)]">
              <pre className="whitespace-pre-wrap break-all font-mono text-[10px]">
                {toolCall.result.substring(0, 2000)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- History View ----------

function HistoryView({
  onSelect,
  onNewInvestigation,
}: {
  onSelect: (record: CostAnalysisRecord) => void
  onNewInvestigation: () => void
}) {
  const { data, isLoading } = useCostAnalyses()
  const deleteMutation = useDeleteCostAnalysis()
  const analyses = data?.data || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--color-text)]">Cost Analysis</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            AI-powered cost variance investigations
          </p>
        </div>
        <button
          onClick={onNewInvestigation}
          className="px-4 py-2 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 transition-colors"
        >
          New Investigation
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-text-tertiary)]" />
        </div>
      ) : analyses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <DollarSign className="h-12 w-12 text-[var(--color-text-tertiary)] opacity-30 mb-3" />
          <p className="text-sm font-medium text-[var(--color-text-secondary)]">
            No investigations yet
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-1 max-w-xs">
            Start a new investigation to analyze cost variance for a job, spec, or customer.
          </p>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Job #</th>
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Spec #</th>
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Customer</th>
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Variance</th>
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Root Cause</th>
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Verdict</th>
                <th className="px-4 py-2.5 text-left font-medium text-[var(--color-text-secondary)]">Date</th>
                <th className="px-4 py-2.5 text-right font-medium text-[var(--color-text-secondary)]"></th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => onSelect(a)}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-bg-hover)] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2.5 text-[var(--color-text)] font-mono">{a.jobNumber || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text)] font-mono">{a.specNumber || '—'}</td>
                  <td className="px-4 py-2.5 text-[var(--color-text)]">{a.customerName || '—'}</td>
                  <td className="px-4 py-2.5">
                    {a.varianceAmount != null ? (
                      <span className={a.varianceAmount < 0 ? 'text-rose-500' : 'text-emerald-500'}>
                        ${a.varianceAmount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{a.rootCauseCategory || '—'}</td>
                  <td className="px-4 py-2.5">
                    {a.verdict && (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        a.verdict === 'profitable' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        a.verdict === 'loss' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' :
                        'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {a.verdict}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-text-tertiary)] text-xs">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(a.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Delete this analysis?')) {
                          deleteMutation.mutate(a.id)
                        }
                      }}
                      className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)] hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------- Investigation View ----------

function InvestigationView({
  onBack,
  initialRecord,
}: {
  onBack: () => void
  initialRecord?: CostAnalysisRecord
}) {
  const { messages, isStreaming, status, investigate, stopInvestigation, clearMessages } = useInvestigation()
  const saveMutation = useSaveCostAnalysis()
  const [jobNumber, setJobNumber] = useState(initialRecord?.jobNumber || '')
  const [specNumber, setSpecNumber] = useState(initialRecord?.specNumber || '')
  const [customerName, setCustomerName] = useState(initialRecord?.customerName || '')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [hasStarted, setHasStarted] = useState(!!initialRecord)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleStart = () => {
    if (!jobNumber && !specNumber && !customerName && !invoiceNumber) return
    setHasStarted(true)
    clearMessages()
    investigate({
      jobNumber: jobNumber || undefined,
      specNumber: specNumber || undefined,
      customerName: customerName || undefined,
      invoiceNumber: invoiceNumber || undefined,
    })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleStart()
    }
  }

  const handleSave = () => {
    const fullContent = messages.map((m) => m.content).join('\n')

    // Try to extract structured data from JSON block in the report
    let structured: Record<string, unknown> = {}
    const jsonMatch = fullContent.match(/```json\s*\n([\s\S]*?)\n```/)
    if (jsonMatch) {
      try {
        structured = JSON.parse(jsonMatch[1])
      } catch { /* */ }
    }

    saveMutation.mutate({
      jobNumber: (structured.job_number as string) || jobNumber || null,
      specNumber: (structured.spec_number as string) || specNumber || null,
      customerName: (structured.customer_name as string) || customerName || null,
      preCostPerM: structured.pre_cost_per_m || null,
      postCostPerM: structured.post_cost_per_m || null,
      varianceAmount: structured.variance_amount || null,
      variancePct: structured.variance_pct || null,
      rootCauseCategory: structured.root_cause_category || null,
      marginPct: structured.margin_pct || null,
      verdict: structured.verdict || null,
      report: fullContent,
      chatHistory: messages,
      status: 'completed',
    })
  }

  // If viewing a saved record, show the report
  if (initialRecord?.report) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">
              {initialRecord.jobNumber ? `Job ${initialRecord.jobNumber}` : initialRecord.specNumber ? `Spec ${initialRecord.specNumber}` : 'Cost Analysis'}
            </h2>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {new Date(initialRecord.createdAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-6">
          <div className="investigation-report prose prose-sm max-w-none text-[var(--color-text)] prose-headings:text-[var(--color-text)] prose-strong:text-[var(--color-text)] prose-th:text-[var(--color-text-secondary)] prose-td:text-[var(--color-text)]">
            <Markdown remarkPlugins={[remarkGfm]}>{initialRecord.report}</Markdown>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-bold text-[var(--color-text)]">New Investigation</h2>
        <div className="ml-auto flex items-center gap-2">
          {messages.length > 0 && !isStreaming && (
            <button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-colors"
            >
              {saveMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveMutation.isSuccess ? (
                <>Saved</>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" />
                  Save Analysis
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Input Form */}
      {!hasStarted && (
        <div className="flex flex-col items-center justify-center flex-1 max-w-lg mx-auto w-full space-y-6">
          <div className="text-center">
            <DollarSign className="h-12 w-12 mx-auto text-[var(--color-text-tertiary)] opacity-30 mb-3" />
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Cost Variance Investigation</h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              Enter a job number, spec number, or customer name to start an AI-powered investigation.
            </p>
          </div>

          <div className="w-full space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Job Number</label>
              <input
                type="text"
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 11001"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Spec Number</label>
              <input
                type="text"
                value={specNumber}
                onChange={(e) => setSpecNumber(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 77442"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Invoice Number</label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. 11647"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">Customer Name</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Victoria's"
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
              />
            </div>
            <button
              onClick={handleStart}
              disabled={!jobNumber && !specNumber && !customerName && !invoiceNumber}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Search className="h-4 w-4" />
              Start Investigation
            </button>
          </div>
        </div>
      )}

      {/* Streaming Output */}
      {hasStarted && (
        <div className="flex-1 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              {/* Tool calls */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="mb-2">
                  {msg.toolCalls.map((tc) => (
                    <ToolCallDisplay key={tc.id} toolCall={tc} />
                  ))}
                </div>
              )}

              {/* Text content */}
              {msg.content && (
                <div className="investigation-report prose prose-sm max-w-none text-[var(--color-text)] prose-headings:text-[var(--color-text)] prose-strong:text-[var(--color-text)] prose-th:text-[var(--color-text-secondary)] prose-td:text-[var(--color-text)] prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2">
                  <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                </div>
              )}

              {/* Loading state */}
              {!msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                <div className="flex items-center gap-1.5 text-[var(--color-text-tertiary)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-xs">Starting investigation...</span>
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />

          {/* Status bar */}
          {status && isStreaming && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
              <Loader2 className="h-3 w-3 animate-spin text-[var(--color-accent)] shrink-0" />
              <span className="truncate">{status.message}</span>
              {status.elapsed != null && (
                <span className="ml-auto shrink-0 text-[var(--color-text-tertiary)]">
                  {(Number(status.elapsed) / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          )}

          {isStreaming && (
            <div className="mt-3 flex justify-center">
              <button
                onClick={stopInvestigation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 text-white text-sm hover:bg-rose-600 transition-colors"
              >
                <Square className="h-3.5 w-3.5" />
                Stop Investigation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Main Page ----------

type View = { type: 'history' } | { type: 'new' } | { type: 'detail'; record: CostAnalysisRecord }

export default function CostAnalysis() {
  const [view, setView] = useState<View>({ type: 'history' })

  if (view.type === 'history') {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <HistoryView
          onSelect={(record) => setView({ type: 'detail', record })}
          onNewInvestigation={() => setView({ type: 'new' })}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <InvestigationView
        onBack={() => setView({ type: 'history' })}
        initialRecord={view.type === 'detail' ? view.record : undefined}
      />
    </div>
  )
}
