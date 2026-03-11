# Estimating System

Complete technical reference for the quoting and cost estimation system. Covers the data model, cost engine, pricing solver, Kiwiplan integration, API endpoints, and frontend architecture.

---

## Architecture Overview

The estimating system spans three layers:

1. **Kiwiplan Gateway** — Read-only SQL access to KDW (data warehouse) and ESP (estimating/production) databases for reference data: board grades, box styles, routings, plant rates, customers, freight zones, and score formulas.
2. **Local D1 (SQLite)** — Stores quotes and line items with cost snapshots. Quotes are the only writable estimating data.
3. **Client-side cost engine** — Pure TypeScript that runs in the browser for instant feedback. Replicates Kiwiplan's cost estimation logic.

```
┌─────────────────────────────────────────────────┐
│  QuoteForm.tsx (browser)                        │
│  ┌──────────┐  ┌────────────┐  ┌────────────┐  │
│  │cost-engine│  │cost-solver │  │score-formula│  │
│  └──────────┘  └────────────┘  └────────────┘  │
│         ↕ React Query hooks                     │
├─────────────────────────────────────────────────┤
│  Hono API (Cloudflare Workers)                  │
│  /erp/quotes   → D1 (quotes, lines)            │
│  /kiwiplan/*   → Kiwiplan Gateway → SQL Server  │
└─────────────────────────────────────────────────┘
```

---

## Key File Locations

| Purpose | Path |
|---------|------|
| Quote DB schema | `apps/api/src/db/schema/erp-quote.ts` |
| Quote API routes | `apps/api/src/routes/erp-quotes.ts` |
| Quote shared Zod schemas | `packages/shared/src/schemas/erp-quote.ts` |
| Cost engine | `apps/web/src/lib/cost-engine.ts` |
| Pricing solver | `apps/web/src/lib/cost-solver.ts` |
| Score formula evaluator | `apps/web/src/lib/score-formula.ts` |
| Quote list page | `apps/web/src/pages/erp/Quotes.tsx` |
| Quote form (create/edit) | `apps/web/src/pages/erp/QuoteForm.tsx` |
| Quote detail (read-only) | `apps/web/src/pages/erp/QuoteDetail.tsx` |
| Quote React Query hooks | `apps/web/src/api/hooks/useErpQuotes.ts` |
| Kiwiplan React Query hooks | `apps/web/src/api/hooks/useKiwiplan.ts` |
| Gateway routes | `packages/kiwiplan-gateway/src/routes/` |

---

## Data Model

### `erp_quote` (D1)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID |
| `organization_id` | text FK | Multi-tenant scoping |
| `quote_number` | text | Auto-generated `QTE-YYYY-NNNN` |
| `customer_id` | integer | Kiwiplan customer ID |
| `customer_name` | text | Denormalized for display |
| `ship_to_address_id` | integer | Kiwiplan address ID |
| `shipping_method` | text | `'freight'` or `'cpu'` |
| `status` | text | `draft → sent → accepted / rejected / expired` |
| `notes` | text | Free-form notes |
| `version` | integer | Optimistic concurrency (starts at 1) |
| `created_at` | text | ISO datetime |
| `created_by_user_id` | text FK | |
| `updated_at` | text | ISO datetime |
| `updated_by_user_id` | text FK | |
| `deleted_at` | text | Soft delete timestamp |

Unique index: `(organization_id, quote_number)`.

### `erp_quote_line` (D1)

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID |
| `quote_id` | text FK | Cascade delete |
| `line_number` | integer | 1-indexed |
| `description` | text | |
| `quantity` | integer | Pieces (default 5000) |
| `box_style` | text | Kiwiplan style code |
| `length` | real | Inches |
| `width` | real | Inches |
| `depth` | real | Inches |
| `board_grade_id` | integer | Kiwiplan board ID |
| `board_grade_code` | text | Denormalized |
| `ink_coverage_percent` | real | 0–100 |
| `is_glued` | integer | 0/1 boolean |
| `cost_snapshot` | text | JSON-stringified `CostResult` |
| `price_per_m` | real | Selling price per 1,000 pcs |
| `qty_per_hour` | real | Machine speed override |

Unique index: `(quote_id, line_number)`.

---

## Kiwiplan Reference Data

All reference data is fetched via React Query hooks that hit the Kiwiplan gateway. Data is read-only.

### Board Grades (`useKiwiplanBoardGrades`)

```typescript
{ boardId, code, description, density, costPerArea, basicBoardName }
```

- `costPerArea` = $/MSF (dollars per thousand sq ft)
- `density` = lbs/MSF
- `basicBoardName` = flute code (`B`, `C`, `D`=BC, `E`, `F`=AC) — used for score formula lookup

### Box Styles (`useKiwiplanStyles`)

```typescript
{ styleId, code, description, analysisGroup }
```

- Styles with routing data show a `✦` badge in the selector
- Style code + board flute determines blank area calculation

### Machine Routing (`useRoutingByStyle(styleId)`)

```typescript
{ machineno, machinename, sequencenumber, routingstdrunrate, costingstdrunrate, routingstdsetupmins, costingstdsetupmins }
```

- Returns ordered machine steps for a product
- `routingstdrunrate` = pcs/hr (standard run speed)
- `routingstdsetupmins` = one-time setup minutes
- Bottleneck machine = step with lowest run rate

### Plant Rates (`useKiwiplanPlantRates`)

```typescript
{ rateId, machineNumber, costRate, costRuleName, activeDate }
```

- Filtered by rule name: `labour`/`labor` → `laborRate`, `manufacturing`/`mfg overhead`/`direct mfg` → `mfgRate`
- Rates are $/hr per machine

### Customers (`useKiwiplanCustomers`)

```typescript
{ customerId, customerNumber, name }
```

- Searchable query with pagination

### Addresses (`useCustomerAddresses(customerId)`)

```typescript
{ addressId, street, city, state, zipcode, deliveryRegionID, standardDespatchModeID, isshiptodefault }
```

### Freight Zone (`useFreightZone(deliveryRegionId)`)

```typescript
{ journeydistance, freightper }
```

- `journeydistance` = miles
- `freightper` = $/cwt (dollars per hundred-weight)

### Despatch Mode (`useDespatchMode(despatchModeId)`)

```typescript
{ name, iscustomerpickup }
```

- Auto-sets `shippingMethod` to `cpu` when `iscustomerpickup = true`

### Score Formulas (`useScoreFormulas`)

```typescript
{ formulas: Array<{ groupId, formula, formulaDescription }>,
  styleGroups: Array<{ code, lwGroupId, wwGroupId }> }
```

- Maps style code → formula group → LW/WW formulas
- Formulas use `L`, `W`, `D` variables with `+`, `-`, `*`, `/`, `RoundDown()`, `RoundUp()`
- Evaluated by `score-formula.ts`

---

## Cost Engine (`cost-engine.ts`)

Pure function: `calculateCosts(inputs: CostInputs): CostResult`

### Inputs

```typescript
interface CostInputs {
  // Product dimensions (inches)
  length: number; width: number; depth: number

  // Board
  boardCostPerMSF: number  // $/MSF
  boardDensity: number     // lbs/MSF

  // Finishes
  inkCoveragePercent: number  // 0–100
  isGlued: boolean
  isHalfUp?: boolean  // 2-up printing

  // Routing
  machineSteps: MachineStep[]

  // Freight
  shippingMethod: 'freight' | 'cpu'
  freightPer: number        // $/cwt
  journeyDistance: number    // miles

  // Config rates
  inkStdRate: number        // $3.50/MSF default
  glueCostPerPiece: number  // $0.002 default
  sgaPercent: number        // 18% default
  fixedMfgPercent: number   // 35% default

  // Order
  quantity: number

  // Blank area
  styleCode: string
  basicBoardName: string
  formulaData: ScoreFormulaData
  blankAreaOverride?: number  // manual sq ft override
}

interface MachineStep {
  machineName: string
  machineNumber: number
  sequenceNumber: number
  runRate: number    // pcs/hr
  setupMins: number  // one-time minutes
  laborRate: number  // $/hr
  mfgRate: number    // $/hr
}
```

### Output

```typescript
interface CostResult {
  // Per-M costs ($ per 1,000 pieces)
  board: number       // Board material
  othMat: number      // Ink + glue
  dirLab: number      // Direct labor
  dirMfg: number      // Direct manufacturing
  trucking: number    // Freight
  direct: number      // *DIRECT subtotal

  fixMfg: number      // Fixed manufacturing overhead
  whse: number        // Warehouse (currently 0)
  plant: number       // *PLANT subtotal

  sgaPlus: number     // SG&A overhead
  total: number       // *100DEX (full cost)

  // One-time costs
  setupCost: number

  // Physical metrics
  blankAreaSqFt: number
  totalSqFt: number
  totalWeight: number
  weightPerM: number
  machineHours: number
  pricePerM: number       // = total (at 100% index)
  formulaUsed: 'kiwiplan' | 'fallback'
}
```

### Calculation Steps

#### 1. Blank Area

Uses `calcBlankDimensions()` from `score-formula.ts`:

1. Look up style → formula group via `styleGroups`
2. Find LW formula matching `"{flutePrefix} GI"` in that group
3. Find WW formula matching `"{flutePrefix} RSC"` (or style code)
4. Evaluate both formulas with L/W/D in mm
5. `blankAreaSqFt = blankLengthMm × blankWidthMm × MM2_TO_SQFT`

**Fallback** (RSC heuristic): `blankL = 2L + 2W + 1.5″ tab`, `blankW = W + 2D`

Manual override via `blankAreaOverride` bypasses all formula logic.

#### 2. Board Cost (per M)

```
areaMSF = blankAreaSqFt / 1000
boardPerM = boardCostPerMSF × areaMSF
```

Note: Board dimensions stored in 1/16" internally; converted via `÷ 192` for feet.

#### 3. Other Materials (per M)

```
inkPerM = inkStdRate × areaMSF × (inkCoveragePercent / 100) × halfUpMultiplier
gluePerM = isGlued ? glueCostPerPiece × 1000 : 0
othMat = inkPerM + gluePerM
```

`halfUpMultiplier` = 0.5 when `isHalfUp` (2-up printing), else 1.0.

#### 4. Labor & Manufacturing (per M, from routing)

For each machine step:
```
runHoursPerM = 1000 / runRate
stepLaborPerM = laborRate × runHoursPerM
stepMfgPerM = mfgRate × runHoursPerM
stepSetup = (laborRate + mfgRate) × (setupMins / 60)  // one-time
```

Sum across all steps → `dirLab`, `dirMfg`, `setupCost`.

#### 5. Freight (per M)

```
weightPerM = boardDensity × areaMSF
truckingPerM = shippingMethod === 'freight' ? freightPer × (weightPerM / 100) : 0
```

#### 6. Subtotals & Overhead

```
*DIRECT  = board + othMat + dirLab + dirMfg + trucking
fixMfg   = dirMfg × (fixedMfgPercent / 100)    // 35% default
*PLANT   = *DIRECT + fixMfg + whse
sgaPlus  = *PLANT × (sgaPercent / 100)          // 18% default
*100DEX  = *PLANT + sgaPlus
```

#### 7. Machine Hours (for order)

```
machineHours = Σ (setupMins/60) + Σ (runHoursPerM × quantity/1000)
```

---

## Pricing Solver (`cost-solver.ts`)

Given a target metric, solves closed-form equations for the required `pricePerM`. No iteration needed.

### Solver Targets

| Target | Formula (solve for Price/M) |
|--------|---------------------------|
| `pricePerM` | Direct set |
| `contDollars` | `value + *DIRECT` |
| `contPercent` | `*DIRECT / (1 - value/100)` |
| `contPerHour` | `(value × machHrs) / (qty/1000) + *DIRECT` |
| `index` | `(value/100 × plantTarget × machHrs) / (qty/1000) + *DIRECT` |

### Contribution Metrics

```typescript
interface ContributionMetrics {
  pricePerM: number
  contDollars: number    // Price/M - *DIRECT
  contPercent: number    // (contDollars / Price/M) × 100
  contPerHour: number    // contDollars × (qty/1000) / machineHours
  index: number          // (contPerHour / plantTarget) × 100
  totalPrice: number     // pricePerM × (qty/1000) + setupCost
  dollarPerMSF: number   // pricePerM / blankAreaSqFt
}
```

Default `plantTarget` = $150/hr.

---

## Quote Workflow

### Status Progression

```
draft → sent → accepted
                rejected
                expired
```

Only `draft` quotes can be deleted (soft delete with `deletedAt`).

### Create Flow

1. Estimator opens `/erp/quotes/new`
2. Selects customer → addresses load → default address auto-selected
3. Despatch mode auto-sets shipping method (freight vs CPU)
4. Selects board grade, box style, enters dimensions
5. Routing loads automatically if style has routing data
6. Cost engine runs on every input change (real-time)
7. Estimator adjusts pricing via what-if solver
8. Optionally overrides QTY/H (machine speed) or blank area
9. Saves → auto-generates `QTE-YYYY-NNNN` number, stores cost snapshot as JSON

### Edit Flow

1. Load existing quote by ID
2. Populate form from saved data + cost snapshot
3. Re-match board/style/address from Kiwiplan data
4. Changes trigger cost recalculation
5. Save sends PATCH with `version` for optimistic concurrency
6. 409 Conflict if another user edited simultaneously

---

## API Endpoints

All routes require `authMiddleware → tenantMiddleware → moduleContextMiddleware('erp')`.

### `GET /api/erp/quotes`

List quotes with pagination, search, and status filter.

**Query params**: `page`, `pageSize`, `status?`, `search?`
**Roles**: ADMIN, FINANCE, ESTIMATOR, VIEWER
**Returns**: `{ data: ErpQuoteListItem[], page, pageSize, total }`

### `GET /api/erp/quotes/:id`

Get single quote with all line items.

**Roles**: ADMIN, FINANCE, ESTIMATOR, VIEWER
**Returns**: `{ data: ErpQuoteDetail }` (includes `lines[]`)

### `POST /api/erp/quotes`

Create a new quote. Auto-generates quote number.

**Roles**: ADMIN, ESTIMATOR
**Body**: `CreateErpQuote` (Zod-validated)
**Returns**: `{ data: ErpQuoteDetail }`
**Audit**: `quote.create`

### `PATCH /api/erp/quotes/:id`

Update quote. Replaces all lines (full line array replacement).

**Roles**: ADMIN, ESTIMATOR
**Body**: `UpdateErpQuote` (includes `version` for concurrency check)
**Returns**: `{ data: ErpQuoteDetail }`
**Audit**: `quote.update`

### `DELETE /api/erp/quotes/:id`

Soft-delete. Only works on `draft` status quotes.

**Roles**: ADMIN
**Returns**: `{ success: boolean }`
**Audit**: `quote.delete`

---

## Frontend Architecture

### QuoteForm Layout

Two-column layout:

**Left column** — Input form:
- Customer & shipping section (customer search, address, freight/CPU toggle, quantity)
- Materials section (board grade, box style, ink %, glue toggle)
- Dimensions section (L × W × D, calculated sq ft with override)
- Routing display (machine steps, bottleneck highlight)

**Right column** — Cost breakdown (sticky):
- Cost table (10 rows: board, othMat, dirLab, dirMfg, trucking, *DIRECT, fixMfg, whse, *PLANT, sgaPlus, *100DEX)
- Physical summary (blank area, weight, sq ft, machine hours, setup cost)
- What-if pricing (5 mutually exclusive targets + QTY/H override)
- Total price display

### State Management

Key state in QuoteForm:
- Selection state: `selectedCustomer`, `selectedAddress`, `selectedBoard`, `selectedStyle`
- Spec inputs: `quantity`, `length`, `width`, `depth`, `inkCoveragePct`, `isGlued`
- Overrides: `qtyPerHour`, `sqFtOverride`
- Pricing: `whatIfField` (target type), `whatIfValue`

Computed (memoized):
1. `avgRates` — average labor/mfg from plant rates (fallback)
2. `machineSteps` — built from routing + plant rates
3. `costInputs` — assembled `CostInputs` object
4. `costs` — full `CostResult` from cost engine
5. `pricePerM` — from solver or engine
6. `contribution` — all pricing metrics

### React Query Hooks

```typescript
useErpQuotes(filters)       // List with pagination
useErpQuote(id)             // Single quote + lines
useCreateErpQuote()         // POST mutation → invalidates list
useUpdateErpQuote(id)       // PATCH mutation → invalidates list
useDeleteErpQuote()         // DELETE mutation → invalidates list
```

### Searchable Selects

Two variants used throughout the form:
- `SearchableSelect` — filters a local array
- `SearchableSelectWithQuery` — async search with debounce (customers)

---

## KDW/ESP Tables Reference

### KDW (Kiwiplan Data Warehouse)

| Table | Key Columns | Used For |
|-------|-------------|----------|
| `dwproductionfeedback` | quantity_fed_in, dates | Actual production volumes |
| `dwjobseriesstep` | feedback_start/finish | Actual hours per job |
| `dwcostcenters` | costcenter_number, optimum_run_speed | Machine definitions |
| `dwproductionorders` | job, customer, spec | Order/customer info |
| `dwshiftcalendar` | shift definitions | Shift handling |

### ESP (Estimating System)

| Table | Key Columns | Used For |
|-------|-------------|----------|
| `espOrder` | job → estimates, routing | Links jobs to estimates |
| `cstCostEstimate` | materialcost, labourcost, freightcost (per 1000) | Estimated costs |
| `ocsPostcostedorder` | links to actual estimate | Post-costing actual vs est |
| `espMachineRouteStep` | run rates, setup mins | Routing with speeds |
| `ebxStandardBoard` | board grades, density, cost | Board reference |
| `ebxScoreFormula` | blank area formulas | Score formulas |

### Querying Ad-Hoc

```bash
curl -s -X POST http://localhost:3099/api/erp/plant-tv/query \
  -H "Content-Type: application/json" \
  -H 'X-Dev-User: {"userId":"dev","email":"dev@test.com","displayName":"Dev","roles":["ADMIN"],"organizationId":"00000000-0000-0000-0000-000000000001"}' \
  -H "X-Organization-Id: 00000000-0000-0000-0000-000000000001" \
  -H "X-Module-Code: erp" \
  -d '{"sql": "SELECT TOP 10 * FROM cstCostEstimate", "database": "esp"}'
```

---

## Cost Variance Integration

The cost variance dashboard (`cost-variance-dashboard.ts`) compares **estimated** costs (from ESP `cstCostEstimate`) to **actual** production data (from KDW `dwproductionfeedback`). Key concepts:

- **Machine count adjustment**: Jobs with 2-pass routings (2 corrugators) report the same quantity from each machine. `adjQty = quantityProduced / machineCount` deduplicates.
- **ESP costs are per 1,000 units**: Divide by 1000 before multiplying by quantity.
- **Estimated hours**: Calculated from routing steps: `setupHrs + (1000/runRate) × (totalAdjQty/1000)` per step, summed and distributed proportionally.
- **Variance**: `estimated - actual` (positive = under budget).

---

## Security & Roles

| Role | Create/Edit Quote | Delete Quote | View Quotes |
|------|-------------------|--------------|-------------|
| ADMIN | Yes | Yes (draft only) | Yes |
| ESTIMATOR | Yes | No | Yes |
| FINANCE | No | No | Yes |
| VIEWER | No | No | Yes |

All mutations require audit logging via `logAudit()`. See CLAUDE.md for full audit requirements.

---

## Common Pitfalls

1. **Board cost units**: `costPerArea` from Kiwiplan is $/MSF (per 1,000 sq ft), not per sq ft. The cost engine expects MSF.
2. **Score formula units**: Formulas work in mm internally. Inputs (L/W/D) must be converted from inches × 25.4 before evaluation. Output area converted via `mm² → sq ft`.
3. **Routing rate source**: Use `costingstdrunrate` for costing, `routingstdrunrate` for scheduling. The form uses costing rates by default.
4. **Plant rates filtering**: Filter by `costRuleName` containing `labour`/`labor` or `manufacturing`/`mfg overhead`/`direct mfg`. Rates vary by machine number.
5. **Freight per CWT**: `freightper` is $/cwt (per 100 lbs), not per lb. `truckingPerM = freightPer × (weightPerM / 100)`.
6. **Version concurrency**: Always include `version` in PATCH requests. A 409 means someone else edited the quote — reload and retry.
7. **Cost snapshot is frozen**: The JSON in `cost_snapshot` captures costs at save time. Reopening recalculates from current rates — the snapshot is for historical reference.
8. **QTY/H override**: When set, overrides the primary (bottleneck) machine step's run rate. Other steps keep their standard rates.
9. **Half-up (2-up)**: Halves ink cost — one impression covers two blanks.
10. **Despatch mode auto-sets shipping**: When an address has `iscustomerpickup = true`, shipping method switches to CPU automatically.
