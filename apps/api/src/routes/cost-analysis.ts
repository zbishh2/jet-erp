import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { eq, and, isNull, desc } from 'drizzle-orm'
import type { Env } from '../types/bindings'
import { logAudit } from '../services/audit'
import { hasScopedRole } from '../middleware/role-scope'
import { costAnalysis } from '../db/schema'
import {
  createKiwiplanClient,
  KiwiplanError,
  isKiwiplanConfigured,
} from '../services/kiwiplan-client'

export const costAnalysisRoutes = new Hono<{ Bindings: Env }>()

// ---------- System prompt ----------

const SYSTEM_PROMPT = `You are a cost variance investigation agent for Jet Container's Kiwiplan ERP system.

## CRITICAL QUERY RULES — READ FIRST

1. **USE ONLY THE EXACT SQL TEMPLATES BELOW.** Copy them exactly, replacing only the placeholder values ({JOB_NUMBER}, {ORDER_ID}, etc.) with actual values from previous query results. Do NOT invent your own queries or guess column names.
2. **ONE query per tool call.** Never batch multiple queries.
3. **NEVER use JOINs** — no JOIN keyword, no comma-separated tables in FROM. Single table per query only.
4. **NEVER use subqueries** in WHERE clauses.
5. **All queries use database: "esp"** unless explicitly marked as kdw.
6. **If a query returns a 500 error, SKIP that step and move on.** Do not retry or try variations. Work with the data you have.
7. **Do NOT query for supplementary data** like customer names or product design names. Use what you get from the main queries.

## Investigation Steps

Execute these steps in order. Run ONE query at a time.

### Step 1: Find the Job
\`\`\`sql
SELECT ID, jobnumber, routeID, productdesignID, precostestimateID FROM espOrder WHERE jobnumber = '{JOB_NUMBER}'
\`\`\`
(database: esp) — Note: jobnumber is nvarchar, always use string quotes.

If starting from an invoice number instead:
\`\`\`sql
SELECT ID, invoicenumber, CONVERT(VARCHAR(10), transactiondate, 23) as inv_date FROM espInvoice WHERE invoicenumber = '{INVOICE_NUMBER}'
\`\`\`
(database: esp)
Then:
\`\`\`sql
SELECT orderID, quantity, unitprice, goodsvalue, description FROM espInvoiceLine WHERE invoiceID = {INVOICE_ID}
\`\`\`
(database: esp)
Then:
\`\`\`sql
SELECT ID, jobnumber, routeID, productdesignID, precostestimateID FROM espOrder WHERE ID = {ORDER_ID}
\`\`\`
(database: esp)

### Step 1b: Get Product Design (spec number)
\`\`\`sql
SELECT ID, designnumber, description, companyID FROM ebxProductDesign WHERE ID = {PRODUCT_DESIGN_ID}
\`\`\`
(database: esp) — designnumber is the spec number. Use this in the report, NOT the productdesignID.

### Step 2: Get Post-Cost Estimate ID
\`\`\`sql
SELECT costEstimateID FROM ocsPostcostedorder WHERE orderID = {ORDER_ID}
\`\`\`
(database: esp)

### Step 3: Compare Pre-Cost vs Post-Cost Headers
\`\`\`sql
SELECT ID, materialcost, labourcost, freightcost, fullcost, calculationquantity, costingdate, estimatetype FROM cstCostEstimate WHERE ID IN ({PRE_ID}, {POST_ID})
\`\`\`
(database: esp)
- materialcost, labourcost, freightcost = per-M rates (per 1000 of calculationquantity)
- estimatetype: 2 = pre-cost, 3 = post-cost

### Step 4: Get Pre-Cost Line Items
\`\`\`sql
SELECT ID, costinggroup, costRuleID, totalcost, rulequantity, costrate, purchaseCostID, calculationquantity FROM cstcostEstimateLine WHERE costEstimateID = {PRE_COST_ID} ORDER BY totalcost DESC
\`\`\`
(database: esp)

### Step 5: Get Post-Cost Line Items
\`\`\`sql
SELECT ID, costinggroup, costRuleID, totalcost, rulequantity, costrate, purchaseCostID, calculationquantity FROM cstcostEstimateLine WHERE costEstimateID = {POST_COST_ID} ORDER BY totalcost DESC
\`\`\`
(database: esp)
- costinggroup: 0=material, 1=labour, 2=freight, 3=other
- Rule 3 = "Purchased Sheets-Std Cost" (pre-cost board)
- Rule 122 = "Consumed Board" (post-cost actual board)
- Rule 156 = "Purchased Finished Goods" — KNOWN BUG: double-counts when both in-house and purchased routes exist

### Step 6: Check Routes
\`\`\`sql
SELECT ID, name, productDesignID, routetype, routestatus, isDefault, minimumquantity FROM ebxRoute WHERE productDesignID = {PRODUCT_DESIGN_ID}
\`\`\`
(database: esp)
- routetype: 0=standard, 1=history. isDefault: -1=yes.
- Red flag: Multiple active routes (in-house + purchased) = double-counting bug

### Step 7: Check Invoices for this Order
\`\`\`sql
SELECT invoiceID, orderID, quantity, unitprice, goodsvalue, description, CONVERT(VARCHAR(10), mainttime, 23) as invoice_date FROM espInvoiceLine WHERE orderID = {ORDER_ID}
\`\`\`
(database: esp)

### Step 8: (OPTIONAL) Investigate Purchase Costs
Only if post-cost line items show a purchaseCostID:
\`\`\`sql
SELECT ID, description, uom, supplierCompanyID, productDesignID, routeID, activedate, expirydate FROM cstPurchaseCost WHERE ID = {PURCHASE_COST_ID}
\`\`\`
(database: esp)
\`\`\`sql
SELECT ID, name FROM orgCompany WHERE ID = {SUPPLIER_COMPANY_ID}
\`\`\`
(database: esp)

### Step 9: Analyze and Report
Calculate profitability: compare invoice price/M vs post-cost full cost/M. Check for double-counting (both rule 122 AND rule 156 on same estimate).

## Known Issues

### Double-Counting Bug (Cost Rule 156)
When a spec has BOTH an in-house route AND an active Purchased Finished Goods cost, post-costing includes BOTH consumed board AND purchase cost. Pre-costing correctly excludes the purchase cost. How to identify: post-cost has BOTH rule 122 AND rule 156 lines.

## Report Format

Use this EXACT structure. Use markdown tables for ALL data. Keep prose minimal — let the tables tell the story.

### Section 1: Job Summary (table)
| Field | Value |
|---|---|
| Job # | 14326 |
| Spec | 77442 |
| Description | DC 7 x 3 x 2 |
| Order Qty | 174,564 pcs |
| Route | 3101 (In-house, Default) |
| Pre-Cost Date | 2025-06-19 |
| Post-Cost Date | 2025-05-08 |

### Section 2: Cost Comparison (table)
Variance = Pre-Cost minus Post-Cost. Positive = under budget (good). Negative = over budget (bad).
| | Pre-Cost | Post-Cost | Variance |
|---|---|---|---|
| Material/M | $86.55 | $221.18 | -$134.63 (-155.5%) |
| Labour/M | $1.26 | $1.03 | +$0.23 (+18.3%) |
| Freight/M | $0.57 | $0.58 | -$0.01 (-1.8%) |
| **Full Cost/M** | **$88.73** | **$223.02** | **-$134.29** |

### Section 3: Top Cost Drivers (table, sorted by impact)
| Rule | Description | Pre-Cost | Post-Cost | Impact |
|---|---|---|---|---|
| 122 | Consumed Board | — | $87.30/M | Board actual |
| 156 | Purchased FG | — | $130.00/M | ⚠️ Double-count |
| 3 | Purchased Sheets | $82.23/M | — | Board standard |

### Section 4: Root Cause
2-3 sentences max. State the cause directly.

### Section 5: Profitability (table)
| Metric | Value |
|---|---|
| Invoice Price/M | $165.00 |
| Correct Cost/M | $95.00 |
| Reported Cost/M | $223.02 |
| Actual Margin | 42% |
| Reported Margin | -35% (LOSS) |

### Section 6: Recommendations
Bulleted list, 2-4 items max.

### Section 7: JSON Summary (hidden, for system use)
\`\`\`json
{"job_number": "", "spec_number": "", "customer_name": "", "pre_cost_per_m": 0, "post_cost_per_m": 0, "variance_amount": 0, "variance_pct": 0, "root_cause_category": "", "margin_pct": 0, "verdict": "profitable|loss|inconclusive"}
\`\`\`

IMPORTANT: Format ALL currency as $X,XXX.XX. Format percentages with 1 decimal. Use /M to mean "per 1000 pieces". Keep the report concise — no filler paragraphs.`

// ---------- Tool definition ----------

const QUERY_TOOL = {
  name: 'query_kiwiplan',
  description:
    'Execute a read-only SQL SELECT query against the Kiwiplan database. Use "database": "esp" for cost estimates, orders, invoices, routes, purchase costs. Use "database": "kdw" for production feedback, OEE, throughput.',
  input_schema: {
    type: 'object' as const,
    properties: {
      sql: {
        type: 'string' as const,
        description: 'The SQL SELECT query to execute. Must start with SELECT or WITH.',
      },
      database: {
        type: 'string' as const,
        enum: ['esp', 'kdw'],
        description: 'Which database to query.',
      },
    },
    required: ['sql', 'database'],
  },
}

// ---------- Tool execution ----------

const QUERY_TIMEOUT_MS = 10_000 // 10s per query — single-table lookups should be fast

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

async function executeTool(
  toolInput: { sql?: string; database?: 'esp' | 'kdw' },
  env: Env
): Promise<{ result: string; isError: boolean }> {
  const { sql, database } = toolInput
  if (!sql || !database) {
    return { result: 'Missing required parameters: sql and database', isError: true }
  }

  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return { result: 'Only SELECT queries are allowed.', isError: true }
  }

  if (!isKiwiplanConfigured(env)) {
    return { result: 'Kiwiplan gateway is not configured.', isError: true }
  }

  const client = createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })

  try {
    const { data } = await withTimeout(
      client.rawQuery(sql, undefined, database),
      QUERY_TIMEOUT_MS,
      `Query to ${database}`
    )
    const rowCount = data.length
    const truncated = rowCount > 100 ? data.slice(0, 100) : data
    const resultStr = JSON.stringify(truncated, null, 2)
    const suffix = rowCount > 100 ? `\n\n(Showing first 100 of ${rowCount} rows)` : ''
    return { result: `${rowCount} row(s) returned:\n${resultStr}${suffix}`, isError: false }
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return { result: `SQL Error (${err.statusCode}): ${err.message}`, isError: true }
    }
    return { result: `Query failed: ${(err as Error).message}. Try simplifying the query or adding a more restrictive WHERE clause.`, isError: true }
  }
}

// ---------- Streaming ----------

async function* parseClaudeStream(
  response: Response
): AsyncGenerator<{
  event: string
  data: unknown
  _toolUseBlocks: Array<{ id: string; name: string; inputJson: string }>
  _stopReason: string | null
}> {
  const reader = response.body?.getReader()
  if (!reader) {
    yield { event: 'error', data: { message: 'No response body' }, _toolUseBlocks: [], _stopReason: null }
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  const toolUseBlocks: Array<{ id: string; name: string; inputJson: string }> = []
  let stopReason: string | null = null
  let currentToolIndex = -1

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '' || raw === '[DONE]') continue

      try {
        const evt = JSON.parse(raw)

        if (evt.type === 'content_block_start') {
          if (evt.content_block?.type === 'tool_use') {
            currentToolIndex = toolUseBlocks.length
            toolUseBlocks.push({
              id: evt.content_block.id,
              name: evt.content_block.name,
              inputJson: '',
            })
            yield {
              event: 'tool_start',
              data: { id: evt.content_block.id, name: evt.content_block.name },
              _toolUseBlocks: toolUseBlocks,
              _stopReason: stopReason,
            }
          }
        }

        if (evt.type === 'content_block_delta') {
          if (evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield {
              event: 'text',
              data: { content: evt.delta.text },
              _toolUseBlocks: toolUseBlocks,
              _stopReason: stopReason,
            }
          }
          if (evt.delta?.type === 'input_json_delta' && evt.delta.partial_json && currentToolIndex >= 0) {
            toolUseBlocks[currentToolIndex].inputJson += evt.delta.partial_json
          }
        }

        if (evt.type === 'message_delta' && evt.delta?.stop_reason) {
          stopReason = evt.delta.stop_reason
        }
      } catch {
        // Skip malformed JSON
      }
    }
  }

  yield {
    event: '_stream_end',
    data: {},
    _toolUseBlocks: toolUseBlocks,
    _stopReason: stopReason,
  }
}

async function* streamInvestigation(
  jobNumber: string | undefined,
  specNumber: string | undefined,
  customerName: string | undefined,
  invoiceNumber: string | undefined,
  env: Env
): AsyncGenerator<{ event: string; data: unknown }> {
  if (!env.ANTHROPIC_API_KEY) {
    yield { event: 'error', data: { message: 'ANTHROPIC_API_KEY is not configured' } }
    return
  }

  // Build the seed user message
  const parts: string[] = []
  if (jobNumber) parts.push(`Job number: ${jobNumber}`)
  if (specNumber) parts.push(`Spec number: ${specNumber}`)
  if (customerName) parts.push(`Customer: ${customerName}`)
  if (invoiceNumber) parts.push(`Invoice number: ${invoiceNumber}`)
  const userPrompt = `Investigate the cost variance for the following:\n${parts.join('\n')}\n\nPlease run through the full investigation workflow and produce a detailed report.`

  const apiMessages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: userPrompt },
  ]

  const maxToolRounds = 10
  let round = 0
  const investigationStart = Date.now()

  try {
  while (true) {
    const body: Record<string, unknown> = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
      stream: true,
      tools: [QUERY_TOOL],
    }

    yield {
      event: 'status',
      data: {
        phase: 'claude_request',
        message: round === 0 ? 'Starting analysis...' : `Continuing analysis (round ${round + 1})...`,
        round: round + 1,
        elapsed: Date.now() - investigationStart,
      },
    }

    const claudeStart = Date.now()
    let response: Response
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      yield {
        event: 'error',
        data: {
          message: `Claude API connection failed: ${(err as Error).message}`,
          phase: 'claude_request',
          elapsed: Date.now() - investigationStart,
        },
      }
      return
    }

    if (!response.ok) {
      const errorBody = await response.text()
      yield {
        event: 'error',
        data: {
          message: `Claude API error: ${response.status} ${errorBody.substring(0, 200)}`,
          phase: 'claude_response',
          elapsed: Date.now() - investigationStart,
        },
      }
      return
    }

    yield {
      event: 'status',
      data: {
        phase: 'claude_streaming',
        message: 'Receiving AI response...',
        claudeLatency: Date.now() - claudeStart,
        elapsed: Date.now() - investigationStart,
      },
    }

    let toolUseBlocks: Array<{ id: string; name: string; inputJson: string }> = []
    let stopReason: string | null = null

    for await (const chunk of parseClaudeStream(response)) {
      toolUseBlocks = chunk._toolUseBlocks
      stopReason = chunk._stopReason

      if (chunk.event === 'text' || chunk.event === 'tool_start') {
        yield { event: chunk.event, data: chunk.data }
      }
    }

    yield {
      event: 'status',
      data: {
        phase: 'claude_complete',
        message: `AI response complete (${((Date.now() - claudeStart) / 1000).toFixed(1)}s)`,
        stopReason,
        toolCount: toolUseBlocks.length,
        elapsed: Date.now() - investigationStart,
      },
    }

    if (stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
      break
    }

    round++
    if (round > maxToolRounds) {
      yield {
        event: 'text',
        data: { content: '\n\n*Reached maximum query limit. Investigation may be incomplete.*' },
      }
      break
    }

    // Build assistant message with tool_use content blocks
    const assistantContent: Array<Record<string, unknown>> = []
    for (const block of toolUseBlocks) {
      let parsedInput: unknown = {}
      try { parsedInput = JSON.parse(block.inputJson) } catch { /* */ }
      assistantContent.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: parsedInput,
      })
    }
    apiMessages.push({ role: 'assistant', content: assistantContent })

    // Execute tools and yield results
    const toolResults: Array<Record<string, unknown>> = []
    for (const block of toolUseBlocks) {
      let parsedInput: Record<string, unknown> = {}
      try { parsedInput = JSON.parse(block.inputJson) as Record<string, unknown> } catch { /* */ }

      const queryDb = (parsedInput.database as string) || 'unknown'
      const querySql = ((parsedInput.sql as string) || '').substring(0, 80)

      yield {
        event: 'status',
        data: {
          phase: 'tool_executing',
          message: `Querying ${queryDb.toUpperCase()}: ${querySql}...`,
          toolId: block.id,
          elapsed: Date.now() - investigationStart,
        },
      }

      const toolStart = Date.now()
      const { result, isError } = await executeTool(
        parsedInput as { sql?: string; database?: 'esp' | 'kdw' },
        env
      )
      const toolDuration = Date.now() - toolStart

      yield {
        event: 'status',
        data: {
          phase: 'tool_complete',
          message: `Query ${isError ? 'failed' : 'completed'} (${(toolDuration / 1000).toFixed(1)}s)`,
          toolId: block.id,
          duration: toolDuration,
          isError,
          elapsed: Date.now() - investigationStart,
        },
      }

      yield {
        event: 'tool_result',
        data: {
          id: block.id,
          name: block.name,
          input: parsedInput,
          result: result.substring(0, 5000),
          isError,
          duration: toolDuration,
        },
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
        is_error: isError,
      })

      // Small delay between queries to avoid overwhelming the Kiwiplan gateway
      if (toolUseBlocks.indexOf(block) < toolUseBlocks.length - 1) {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    apiMessages.push({ role: 'user', content: toolResults })
  }

  yield {
    event: 'status',
    data: {
      phase: 'complete',
      message: `Investigation complete (${((Date.now() - investigationStart) / 1000).toFixed(1)}s total)`,
      totalRounds: round + 1,
      elapsed: Date.now() - investigationStart,
    },
  }
  yield { event: 'done', data: {} }

  } catch (err) {
    // Catch any unhandled errors so the frontend knows what happened
    yield {
      event: 'error',
      data: {
        message: `Investigation crashed: ${(err as Error).message}`,
        phase: 'fatal',
        elapsed: Date.now() - investigationStart,
      },
    }
    yield { event: 'done', data: {} }
  }
}

// ---------- CRUD Routes ----------

// GET /cost-analysis — list saved analyses
costAnalysisRoutes.get('/', async (c) => {
  const db = c.get('db')
  const auth = c.get('auth')

  const results = await db
    .select()
    .from(costAnalysis)
    .where(
      and(
        eq(costAnalysis.organizationId, auth.organizationId),
        isNull(costAnalysis.deletedAt)
      )
    )
    .orderBy(desc(costAnalysis.createdAt))
    .limit(100)

  return c.json({ data: results })
})

// GET /cost-analysis/:id — get single analysis
costAnalysisRoutes.get('/:id', async (c) => {
  const db = c.get('db')
  const auth = c.get('auth')
  const id = c.req.param('id')

  const [result] = await db
    .select()
    .from(costAnalysis)
    .where(
      and(
        eq(costAnalysis.id, id),
        eq(costAnalysis.organizationId, auth.organizationId),
        isNull(costAnalysis.deletedAt)
      )
    )
    .limit(1)

  if (!result) return c.json({ error: 'Not found' }, 404)
  return c.json({ data: result })
})

// POST /cost-analysis — save an analysis
costAnalysisRoutes.post('/', async (c) => {
  const db = c.get('db')
  const auth = c.get('auth')
  const body = await c.req.json()

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await db.insert(costAnalysis).values({
    id,
    organizationId: auth.organizationId,
    jobNumber: body.jobNumber || null,
    specNumber: body.specNumber || null,
    customerName: body.customerName || null,
    preCostPerM: body.preCostPerM || null,
    postCostPerM: body.postCostPerM || null,
    varianceAmount: body.varianceAmount || null,
    variancePct: body.variancePct || null,
    rootCauseCategory: body.rootCauseCategory || null,
    marginPct: body.marginPct || null,
    verdict: body.verdict || null,
    report: body.report || null,
    chatHistory: body.chatHistory ? JSON.stringify(body.chatHistory) : null,
    status: body.status || 'completed',
    createdByUserId: auth.userId,
    createdAt: now,
    updatedAt: now,
  })

  await logAudit(c, {
    action: 'cost_analysis.create',
    resource: 'cost_analysis',
    resourceId: id,
    metadata: { jobNumber: body.jobNumber, specNumber: body.specNumber },
  })

  return c.json({ data: { id } }, 201)
})

// DELETE /cost-analysis/:id — soft delete
costAnalysisRoutes.delete('/:id', async (c) => {
  const db = c.get('db')
  const auth = c.get('auth')
  const id = c.req.param('id')

  await db
    .update(costAnalysis)
    .set({ deletedAt: new Date().toISOString() })
    .where(
      and(
        eq(costAnalysis.id, id),
        eq(costAnalysis.organizationId, auth.organizationId)
      )
    )

  await logAudit(c, {
    action: 'cost_analysis.delete',
    resource: 'cost_analysis',
    resourceId: id,
  })

  return c.json({ success: true })
})

// ---------- SSE Investigation Endpoint ----------

costAnalysisRoutes.post('/investigate', async (c) => {
  const auth = c.get('auth')
  if (!hasScopedRole(auth, 'ADMIN') && !hasScopedRole(auth, 'FINANCE')) {
    return c.json({ error: 'Requires ADMIN or FINANCE role' }, 403)
  }

  const body = await c.req.json<{
    jobNumber?: string
    specNumber?: string
    customerName?: string
    invoiceNumber?: string
  }>()

  if (!body.jobNumber && !body.specNumber && !body.customerName && !body.invoiceNumber) {
    return c.json({ error: 'At least one of jobNumber, specNumber, customerName, or invoiceNumber is required' }, 400)
  }

  await logAudit(c, {
    action: 'cost_analysis.investigate',
    resource: 'cost_analysis',
    metadata: {
      jobNumber: body.jobNumber,
      specNumber: body.specNumber,
      customerName: body.customerName,
      invoiceNumber: body.invoiceNumber,
    },
  })

  return streamSSE(c, async (stream) => {
    for await (const event of streamInvestigation(
      body.jobNumber,
      body.specNumber,
      body.customerName,
      body.invoiceNumber,
      c.env
    )) {
      await stream.writeSSE({
        event: event.event,
        data: JSON.stringify(event.data),
      })
    }
  })
})
