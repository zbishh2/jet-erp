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

## Theme Rules

- Never hardcode text/background colors — use CSS variables (`var(--color-text)`, `var(--color-bg-secondary)`, etc.)
- Chart series colors (`#6366f1` indigo, `#a78bfa` violet) are OK as hex — they work on both light and dark
- See `apps/web/src/index.css` for the full variable list
- All Recharts tooltips must use `var(--color-bg-secondary)` background and `var(--color-text)` label/item colors

## Patterns

- **State persistence**: Use `usePersistedState` for filter state (localStorage-backed). Each dashboard should use a unique prefix.
- **Animations**: Disable Recharts animations (`isAnimationActive={false}`) for snappy interactions.
- **Recharts + shadcn Tooltip conflict**: Import Recharts Tooltip as `RechartsTooltip` to avoid name collision.

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
