# AI Chat Assistant — Implementation Plan

## Overview

A floating chat bubble (bottom-right) that opens a chat panel where users can ask questions about the ERP system. Claude acts as the brain — it can explain business logic, run SQL queries against the Kiwiplan/ESP database, explore the schema, and reference existing dashboard queries to answer questions comprehensively.

**Architecture**: Frontend → Backend streaming endpoint → Claude API (with tool use) → Kiwiplan Gateway

---

## Backend

### 1. Add `ANTHROPIC_API_KEY` to env

- **`apps/api/src/types/bindings.ts`** — Add `ANTHROPIC_API_KEY?: string` to `Env`
- **`apps/api/wrangler.toml`** — Add comment for `wrangler secret put ANTHROPIC_API_KEY`

### 2. New route: `apps/api/src/routes/chat.ts`

**Endpoint**: `POST /api/erp/chat`
**Auth**: ADMIN role required (same as SQL Explorer)
**Request body**:
```ts
{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}
```

**Response**: Server-Sent Events (SSE) stream — `text/event-stream`

**Flow**:
1. Validate input (messages array, last message is from user)
2. Build Claude API request with system prompt + tools
3. Stream response back to client
4. When Claude invokes a tool (e.g., `run_sql_query`), execute it server-side via the Kiwiplan client, feed results back into Claude, and continue streaming
5. Audit log the interaction (action: `chat.message`, metadata: first 200 chars of user message)

### 3. Claude Tools (function calling)

Three tools the assistant can use:

| Tool | Description | Implementation |
|------|-------------|----------------|
| `run_sql_query` | Execute a read-only SQL query against ESP or KDW | Uses `kiwiplanClient.rawQuery()` — same validation as SQL Explorer |
| `find_tables` | Search for tables matching a name pattern | Uses `kiwiplanClient.findTables()` |
| `get_table_columns` | Get column names/types for a table | Uses `kiwiplanClient.getTableColumns()` |

### 4. System Prompt

A comprehensive system prompt giving Claude context about:
- **Business domain**: Corrugated box manufacturing ERP (Kiwiplan/ESP)
- **Key tables**: `espInvoice`, `espInvoiceLine`, `espOrder`, `orgCompany`, `orgContact`, `cstCostEstimate`, `espProductDesign`, etc.
- **Common relationships**: Invoice→InvoiceLine, Order→ProductDesign→CostEstimate, Company→Contact (sales rep)
- **Dashboard query patterns**: Revenue = `SUM(il.totalvalue)`, MSF = `SUM(il.areainvoiced)/1000`, Cost = CostEstimate fullcost, etc.
- **Safety rules**: Read-only queries, TOP 100 limit by default, no PII exposure

### 5. Mount in `apps/api/src/app.ts`

Add `chatRoutes` to the ERP sub-app:
```ts
erpApp.route('/chat', chatRoutes)
```

---

## Frontend

### 6. Chat bubble component: `apps/web/src/components/chat/ChatBubble.tsx`

- **Floating button**: Fixed bottom-right (bottom-6 right-6), uses Lucide `MessageCircle` icon
- **Chat panel**: Fixed-position panel (400px wide, ~600px tall) that slides up when opened
- **Messages**: User messages (right-aligned, accent bg) and assistant messages (left-aligned, secondary bg)
- **Input**: Textarea at bottom with send button, Enter to send, Shift+Enter for newline
- **Streaming**: Text appears token-by-token as it streams in
- **SQL results**: When the assistant runs a query, show the results inline in a collapsible table
- **Theme**: Uses CSS variables (`var(--color-bg-secondary)`, `var(--color-text)`, etc.)
- **State**: Conversation history kept in React state (client-side, resets on refresh)

### 7. Streaming hook: `apps/web/src/api/hooks/useChat.ts`

- Manages messages array
- `sendMessage(text)` → POST to `/api/erp/chat` with full conversation
- Reads SSE stream, parses events, updates assistant message in real-time
- Handles tool-use events (to show "Running query..." indicators)
- Error handling with toast notifications

### 8. Mount in layout: `apps/web/src/components/layout/MainLayout.tsx`

Add `<ChatBubble />` after the `<main>` element so it floats above all page content.

---

## SSE Event Protocol

Events streamed from backend to frontend:

| Event | Data | Purpose |
|-------|------|---------|
| `text` | `{ content: "..." }` | Text token from Claude |
| `tool_start` | `{ tool: "run_sql_query", input: {...} }` | Tool invocation started |
| `tool_result` | `{ tool: "run_sql_query", data: [...], rowCount: N }` | Tool result (for inline display) |
| `done` | `{}` | Stream complete |
| `error` | `{ message: "..." }` | Error occurred |

---

## File Summary

| File | Action |
|------|--------|
| `apps/api/src/types/bindings.ts` | Add `ANTHROPIC_API_KEY` |
| `apps/api/src/routes/chat.ts` | **New** — Chat endpoint + Claude integration |
| `apps/api/src/app.ts` | Mount chat route |
| `apps/api/wrangler.toml` | Add secret comment |
| `apps/web/src/components/chat/ChatBubble.tsx` | **New** — Floating chat UI |
| `apps/web/src/api/hooks/useChat.ts` | **New** — Streaming chat hook |
| `apps/web/src/components/layout/MainLayout.tsx` | Mount ChatBubble |

No new npm dependencies needed — Claude API called via raw `fetch` (Workers-compatible), SSE parsed with native `EventSource`/`ReadableStream` on the frontend.
