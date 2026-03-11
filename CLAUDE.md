# Jet ERP - Agent Guidelines

## Tech Stack

- **Frontend**: React 18, TypeScript, TailwindCSS, shadcn/ui, Recharts, React Query, React Hook Form
- **Backend**: Hono on Cloudflare Workers, Drizzle ORM, D1 (SQLite)
- **Deploy**: `npm run deploy:web` (Cloudflare Pages via wrangler)

## Key Directories

```
apps/web/src/pages/erp/       # ERP page components
apps/web/src/api/hooks/        # React Query hooks
apps/web/src/components/ui/    # shadcn/ui components
apps/web/src/index.css         # CSS variables (light/dark theme)
apps/api/src/routes/           # API route handlers
apps/api/src/db/schema/        # Drizzle schemas
```

## Reference Docs

| Topic | Doc |
|-------|-----|
| **Dashboard creation** | [docs/dashboard-patterns.md](./docs/dashboard-patterns.md) — Complete reference for building dashboards. Covers header, KPI cards, area charts, bar charts, tables, theming, and state management. Copy the Sales Dashboard and adapt. |
| **Sq Ft Dashboard** | [docs/sqft-dashboard.md](./docs/sqft-dashboard.md) — Full technical reference for the Sq Ft production dashboard. Covers data model, SQL calculations, PBIP cross-reference, API endpoints, frontend architecture, and common pitfalls. |
| **Cost Variance Investigation** | [docs/investigations/job-11001-cost-variance-investigation.md](./docs/investigations/job-11001-cost-variance-investigation.md) — Reference investigation for post-cost double-counting bug. |

## Skills

- **`/investigate-cost-variance`** — When the user asks to investigate cost variance, analyze post-cost vs pre-cost, or look into why a job's costs are high, **always invoke this skill**. Pass the job number, spec number, or customer name as an argument (e.g. `/investigate-cost-variance 11001`).

## Theme Rules

- Never hardcode text/background colors — use CSS variables (`var(--color-text)`, `var(--color-bg-secondary)`, etc.)
- Chart series colors (`#6366f1` indigo, `#a78bfa` violet) are OK as hex — they work on both light and dark
- See `apps/web/src/index.css` for the full variable list
- All Recharts tooltips must use `var(--color-bg-secondary)` background and `var(--color-text)` label/item colors

## Patterns

- **State persistence**: Use `usePersistedState` for filter state (localStorage-backed). Each dashboard should use a unique prefix.
- **Animations**: Disable Recharts animations (`isAnimationActive={false}`) for snappy interactions.
- **Recharts + shadcn Tooltip conflict**: Import Recharts Tooltip as `RechartsTooltip` to avoid name collision.

## Querying KDW (Kiwiplan Data Warehouse) Freely

The Kiwiplan gateway allows read-only SQL queries against the KDW (SQL Server) database. To run ad-hoc queries during development:

### Local dev server approach

```bash
# 1. Seed local D1 with module data (one-time)
npx wrangler d1 execute jet-erp-db --local --command "INSERT OR IGNORE INTO module (id, code, name, description, created_at, updated_at) VALUES ('mod-erp', 'erp', 'ERP', 'Enterprise Resource Planning', '2024-01-01', '2024-01-01');"
npx wrangler d1 execute jet-erp-db --local --command "INSERT OR IGNORE INTO organization_module (id, organization_id, module_id, is_active, created_at, updated_at) VALUES ('om-1', '00000000-0000-0000-0000-000000000001', 'mod-erp', 1, '2024-01-01', '2024-01-01');"
npx wrangler d1 execute jet-erp-db --local --command "INSERT OR IGNORE INTO user_organization_module (id, user_id, organization_id, module_id, role, created_at, updated_at) VALUES ('uom-1', 'dev', '00000000-0000-0000-0000-000000000001', 'mod-erp', 'ADMIN', '2024-01-01', '2024-01-01');"

# 2. Start dev server (uses prod wrangler.toml for real KV/gateway, local D1, overrides for dev auth)
npx wrangler dev --port 3099 --var ENVIRONMENT:development --var ALLOW_DEV_AUTH:true

# 3. Query KDW via the plant-tv query endpoint (POST /api/erp/plant-tv/query)
curl -s -X POST http://localhost:3099/api/erp/plant-tv/query \
  -H "Content-Type: application/json" \
  -H 'X-Dev-User: {"userId":"dev","email":"dev@test.com","displayName":"Dev","roles":["ADMIN"],"organizationId":"00000000-0000-0000-0000-000000000001"}' \
  -H "X-Organization-Id: 00000000-0000-0000-0000-000000000001" \
  -H "X-Module-Code: erp" \
  -d '{"sql": "SELECT TOP 10 * FROM dwcostcenters"}'

# Query ESP database instead of KDW:
  -d '{"sql": "SELECT TOP 10 * FROM ebxStandardBoard", "database": "esp"}'
```

- The gateway only allows `SELECT` statements (read-only)
- Default database is `kdw` (Kiwiplan Data Warehouse). Pass `"database": "esp"` for the ESP database.
- Queries hit the real SQL Server via `KIWIPLAN_GATEWAY_URL` + `KIWIPLAN_SERVICE_TOKEN` (from `.dev.vars`)
- The endpoint requires ADMIN role
- Returns `{ data: [...] }` format

### Key KDW tables

| Table | Purpose |
|-------|---------|
| `dwproductionfeedback` | Production events (quantity_fed_in, run duration, dates) |
| `dwjobseriesstep` | Job/order details (feedback_start/finish, shift_split_code) |
| `dwcostcenters` | Machine/line definitions (costcenter_number, optimum_run_speed) |
| `dwdowntimes` | Downtime events |
| `dwproductionorders` | Order/customer info |
| `dwshiftcalendar` | Shift definitions (First=06:00-16:00, Second=16:00-22:00) |
| `dwoeerecord` | OEE records with shift info |

### Shift handling

- `jss.crew_id` is **unreliable** (often NULL or contains machine numbers)
- Use time-based derivation from `jss.feedback_start`: First (06-16), Second (16-22)
- Or join to `dwshiftcalendar` for the canonical shift schedule

## Security & Audit Logging (MANDATORY)

All new API routes and features **must** include audit logging. This is a non-negotiable requirement.

### Audit logging (`logAudit`)

Use `logAudit(c, { action, resource, resourceId?, metadata? })` from `../services/audit` for:

- **All mutations** (create, update, delete) on any resource
- **Sensitive reads** (SQL explorer queries, data exports, admin user listings)
- **Admin actions** (invite create/delete, role changes, user deactivation)

```typescript
import { logAudit } from '../services/audit'

// After a successful mutation:
await logAudit(c, {
  action: 'quote.create',
  resource: 'quote',
  resourceId: newQuote.id,
  metadata: { customerName, total },
})
```

### Auth event logging (`logAuthEvent`)

Use `logAuthEvent(c, db, { eventType, email?, userId?, success, failureReason? })` from `../services/audit` for:

- **All login attempts** (success and failure, with failure reason)
- **Signup completions**
- **Logouts**
- **Password resets**
- **Account lockouts / rate limit triggers**

### Rules

1. Audit calls must **never** break the request — both helpers catch errors internally
2. Log **after** the action succeeds, not before (except SQL explorer which logs the query before execution)
3. Truncate large payloads in metadata (e.g. SQL queries to 500 chars)
4. Never log passwords, tokens, or secrets in metadata
5. Schema: `audit_log` and `auth_event` tables in `apps/api/src/db/schema/`
