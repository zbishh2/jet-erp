import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { Env } from '../types/bindings'
import { logAudit } from '../services/audit'
import { hasScopedRole } from '../middleware/role-scope'
import { KNOWLEDGE_BASE, SQL_REFERENCE } from '../knowledge'
import {
  createKiwiplanClient,
  KiwiplanError,
  isKiwiplanConfigured,
} from '../services/kiwiplan-client'

export const chatRoutes = new Hono<{ Bindings: Env }>()

// ---------- System prompts ----------

const NON_ADMIN_RULES = `
## Rules

1. Answer ONLY from the knowledge base above. You have no database access.
2. When a user asks a data question (e.g., "who are our top customers?"), guide them to the specific dashboard, tab, and filter steps — don't try to look up the data.
3. For questions not covered by any dashboard, say: "That information isn't available on the current dashboards. Please reach out to your system administrator for help."
4. Be concise. Use bullet points and step-by-step instructions when guiding users to dashboards.
5. Never generate SQL, offer to query a database, or claim you can access live data.
6. Format currency with $ signs, percentages with % signs. Use markdown for readability.`

const ADMIN_RULES = `
## Rules

1. **Prefer the knowledge base.** For general questions (definitions, how-to, dashboard navigation), answer from the knowledge base — do NOT run SQL.
2. **Only run SQL when the user asks for specific data** that isn't pre-computed on a dashboard (e.g., "top 10 customers last month", "stock level for spec 12345").
3. When you do run SQL, **write the query directly** using the templates in the SQL Reference section. Do not explore the schema — you have all the table/column info you need.
4. Always use \`TOP 100\` or less. Never return unbounded result sets.
5. If a query fails, read the error message carefully and fix the SQL. Do not fall back to schema exploration.
6. Present query results in a clear markdown table. Include a brief interpretation of the data.
7. Format currency with $ signs, percentages with % signs. Use markdown for readability.
8. Be concise. The user is an admin who understands the data.`

function buildSystemPrompt(isAdmin: boolean): string {
  let prompt = `You are a helpful assistant for Jet Container's ERP application. You help users understand dashboards, find the right data, and explain manufacturing/financial concepts.

## Knowledge Base

${KNOWLEDGE_BASE}`

  if (isAdmin) {
    prompt += `\n\n${SQL_REFERENCE}`
    prompt += `\n${ADMIN_RULES}`
  } else {
    prompt += `\n${NON_ADMIN_RULES}`
  }

  return prompt
}

// ---------- Tool definitions (admin only) ----------

const SQL_TOOL = {
  name: 'run_sql_query',
  description:
    'Execute a read-only SQL SELECT query against the Kiwiplan database. Use the "database" parameter to choose ESP (transactional) or KDW (data warehouse). Returns rows as JSON.',
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
        description:
          'Which database to query. Use "esp" for sales/invoicing/inventory/cost-estimates, "kdw" for production feedback/OEE/throughput.',
      },
    },
    required: ['sql', 'database'],
  },
}

// ---------- Tool execution ----------

async function executeTool(
  toolName: string,
  toolInput: { sql?: string; database?: 'esp' | 'kdw' },
  env: Env
): Promise<{ result: string; isError: boolean }> {
  if (toolName !== 'run_sql_query') {
    return { result: `Unknown tool: ${toolName}`, isError: true }
  }

  const { sql, database } = toolInput
  if (!sql || !database) {
    return { result: 'Missing required parameters: sql and database', isError: true }
  }

  // Validate read-only
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
    const { data } = await client.rawQuery(sql, undefined, database)
    const rowCount = data.length
    // Truncate large results
    const truncated = rowCount > 100 ? data.slice(0, 100) : data
    const resultStr = JSON.stringify(truncated, null, 2)
    const suffix = rowCount > 100 ? `\n\n(Showing first 100 of ${rowCount} rows)` : ''
    return { result: `${rowCount} row(s) returned:\n${resultStr}${suffix}`, isError: false }
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return { result: `SQL Error (${err.statusCode}): ${err.message}`, isError: true }
    }
    return { result: `Query execution failed: ${(err as Error).message}`, isError: false }
  }
}

// ---------- Streaming ----------

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Parse a single Claude SSE stream response, yielding our custom events.
// Handles both text deltas and tool_use blocks.
async function* parseClaudeStream(
  response: Response
): AsyncGenerator<{
  event: string
  data: unknown
  // Track accumulated tool use blocks for the caller
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
        // Skip malformed JSON lines
      }
    }
  }

  // Final yield with stop reason
  yield {
    event: '_stream_end',
    data: {},
    _toolUseBlocks: toolUseBlocks,
    _stopReason: stopReason,
  }
}

async function* streamChatResponse(
  messages: ChatMessage[],
  env: Env,
  isAdmin: boolean
): AsyncGenerator<{ event: string; data: unknown }> {
  if (!env.ANTHROPIC_API_KEY) {
    yield { event: 'error', data: { message: 'ANTHROPIC_API_KEY is not configured' } }
    return
  }

  const systemPrompt = buildSystemPrompt(isAdmin)

  // Build the conversation — may grow if we enter a tool-use loop
  const apiMessages: Array<{ role: string; content: unknown }> = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }))

  const maxToolRounds = 3
  let round = 0

  while (true) {
    const body: Record<string, unknown> = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: isAdmin ? 4096 : 2048,
      system: systemPrompt,
      messages: apiMessages,
      stream: true,
    }

    if (isAdmin && isKiwiplanConfigured(env)) {
      body.tools = [SQL_TOOL]
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      yield {
        event: 'error',
        data: { message: `Claude API error: ${response.status} ${errorBody.substring(0, 200)}` },
      }
      return
    }

    // Stream response events to the client
    let toolUseBlocks: Array<{ id: string; name: string; inputJson: string }> = []
    let stopReason: string | null = null

    for await (const chunk of parseClaudeStream(response)) {
      toolUseBlocks = chunk._toolUseBlocks
      stopReason = chunk._stopReason

      // Forward client-facing events
      if (chunk.event === 'text' || chunk.event === 'tool_start') {
        yield { event: chunk.event, data: chunk.data }
      }
    }

    // If model didn't use tools, we're done
    if (stopReason !== 'tool_use' || toolUseBlocks.length === 0) {
      break
    }

    // Guard against runaway loops
    round++
    if (round > maxToolRounds) {
      yield {
        event: 'text',
        data: { content: '\n\n*Reached maximum tool call limit. Please refine your question.*' },
      }
      break
    }

    // Build assistant message with tool_use content blocks
    const assistantContent: Array<Record<string, unknown>> = []
    for (const block of toolUseBlocks) {
      let parsedInput: unknown = {}
      try {
        parsedInput = JSON.parse(block.inputJson)
      } catch {
        // malformed input — will error when executed
      }
      assistantContent.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: parsedInput,
      })
    }
    apiMessages.push({ role: 'assistant', content: assistantContent })

    // Execute each tool and build tool_result messages
    const toolResults: Array<Record<string, unknown>> = []
    for (const block of toolUseBlocks) {
      let parsedInput: Record<string, unknown> = {}
      try {
        parsedInput = JSON.parse(block.inputJson) as Record<string, unknown>
      } catch {
        // handled below
      }

      const { result, isError } = await executeTool(
        block.name,
        parsedInput as { sql?: string; database?: 'esp' | 'kdw' },
        env
      )

      // Send tool result to the client
      yield {
        event: 'tool_result',
        data: {
          id: block.id,
          name: block.name,
          input: parsedInput,
          result: result.substring(0, 5000), // Truncate for the UI
          isError,
        },
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
        is_error: isError,
      })
    }
    apiMessages.push({ role: 'user', content: toolResults })

    // Loop: the next iteration sends the tool results back to Claude for interpretation
  }

  yield { event: 'done', data: {} }
}

// ---------- Route handler ----------

chatRoutes.post('/', async (c) => {
  const body = await c.req.json<{ messages?: ChatMessage[] }>()

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: 'messages array is required' }, 400)
  }

  const lastMessage = body.messages[body.messages.length - 1]
  if (lastMessage.role !== 'user') {
    return c.json({ error: 'Last message must be from user' }, 400)
  }

  const auth = c.get('auth')
  const isAdmin = auth ? hasScopedRole(auth, 'ADMIN') : false

  // Audit log the chat message
  await logAudit(c, {
    action: 'chat.message',
    resource: 'chat',
    metadata: {
      messageCount: body.messages.length,
      userMessage: lastMessage.content.substring(0, 200),
      mode: isAdmin ? 'admin_sql' : 'kb_only',
    },
  })

  return streamSSE(c, async (stream) => {
    for await (const event of streamChatResponse(body.messages!, c.env, isAdmin)) {
      await stream.writeSSE({
        event: event.event,
        data: JSON.stringify(event.data),
      })
    }
  })
})
