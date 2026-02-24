# Cost Variance Dashboard — Technical Reference

## Overview

The Cost Variance Dashboard compares estimated (pre) costs vs actual (post) costs at the job level. It surfaces material, labor, and freight cost variances along with estimated vs actual corrugator hours. The frontend provides a daily-focused area chart, calendar heat map, and a tabbed detail table (Costs | Hours).

## Architecture

The dashboard cannot run a single cross-database SQL query because KDW (Kiwiplan Data Warehouse) and ESP (Estimating System) are separate databases accessed through the Kiwiplan gateway. Instead, the API:

1. Fetches base production feedback rows from **KDW**
2. Extracts unique job numbers from those rows
3. Fires three parallel queries using those job numbers:
   - Machine counts from **KDW**
   - Cost estimates from **ESP**
   - Routing steps from **ESP**
4. Joins everything in JavaScript using lookup maps

This pattern is implemented in `computeCostVarianceRows()`.

## Data Model

### Source Tables

| Table | Database | Purpose |
|-------|----------|---------|
| `dwproductionfeedback` | kdw | Production feedback rows (quantity produced, dates) |
| `dwjobseriesstep` | kdw | Feedback start/finish times → order hours |
| `dwcostcenters` | kdw | Line/cost center numbers |
| `dwproductionorders` | kdw | Job number, customer name, spec number |
| `espOrder` | esp | Links job number to cost estimates and routing |
| `cstCostEstimate` | esp | Cost estimate values (material, labour, freight per 1000 units) |
| `ocsPostcostedorder` | esp | Links order to post-costed (actual) estimate |
| `espMachineRouteStep` | esp | Routing steps with run rates and setup times |

### Base Filter

All queries filter to corrugator cost centers only:

```sql
cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
```

These are the corrugator lines. Non-corrugator machines (board supply, converting, strapping, etc.) are excluded because order hours in KDW only measure corrugator time.

### KDW Base Query

Returns one row per production feedback entry:

```sql
SELECT
  CAST(pf.feedback_report_date AS DATE) as feedbackDate,
  po.job_number as jobNumber,
  po.customer_name as customerName,
  po.spec_number as specNumber,
  cc.costcenter_number as lineNumber,
  DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) / 3600.0 as orderHours,
  pf.quantity_produced as quantityProduced
FROM dwproductionfeedback pf
  INNER JOIN dwjobseriesstep jss ON pf.feedback_job_series_step_id = jss.job_series_step_id
  INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
  LEFT JOIN dwproductionorders po ON pf.feedback_pcs_order_id = po.pcs_order_id
WHERE pf.feedback_report_date >= @startDate
  AND pf.feedback_report_date < @endDate
  AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
```

### Order Hours

`orderHours` = `DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) / 3600.0`

This is the actual wall-clock time the corrugator ran for that feedback entry. It comes directly from KDW — no calculation needed.

## Machine Count & Adjusted Quantity

### Why Machine Count Exists

Some jobs have **2-pass corrugator routings** — the board goes through one corrugator first (e.g., machine 131), then through a second corrugator (e.g., machine 154). Both machines report feedback with roughly the same `quantity_produced` because the same physical boards pass through both.

Without adjustment, summing `quantity_produced` across all feedback rows would double-count the actual order quantity.

### Machine Count Query

```sql
SELECT
  po.job_number as jobNumber,
  COUNT(DISTINCT cc.costcenter_number) as machineCount
FROM dwproductionfeedback pf
  INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
  INNER JOIN dwproductionorders po ON pf.feedback_pcs_order_id = po.pcs_order_id
WHERE cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
  AND po.job_number IN (@jobs...)
GROUP BY po.job_number
```

### Adjusted Quantity

```
adjustedQty = quantityProduced / machineCount
```

- **Single-machine jobs** (machineCount = 1): `adjQty = quantityProduced` (no change)
- **Two-machine jobs** (machineCount = 2): `adjQty = quantityProduced / 2` (corrects for double-counting)

### Validated Example: Job 14338

- Routing: seq 2 = machine 133 (first pass), seq 3 = machine 154 (second pass)
- Feedback from machine 133: 69,016 total qty across 2 rows
- Feedback from machine 154: 66,311 total qty across 3 rows
- Total feedback qty = 135,327 — but this is ~2x the actual boards produced
- machineCount = 2 → adjQty ≈ 67,664 per machine (the true order quantity)

This same adjusted quantity is used for both cost calculations and estimated hours.

## Cost Calculations

### ESP Cost Estimate Query

```sql
SELECT
  o.jobnumber as jobNumber,
  pce.materialcost / 1000.0 as preMaterialCostPerUnit,   -- estimated
  pce.labourcost / 1000.0 as preLaborCostPerUnit,
  pce.freightcost / 1000.0 as preFreightCostPerUnit,
  postce.materialcost / 1000.0 as postMaterialCostPerUnit, -- actual
  postce.labourcost / 1000.0 as postLaborCostPerUnit,
  postce.freightcost / 1000.0 as postFreightCostPerUnit
FROM espOrder o
  LEFT JOIN cstCostEstimate pce ON o.precostestimateID = pce.ID          -- pre (estimated)
  LEFT JOIN ocsPostcostedorder pco ON o.ID = pco.orderID
  LEFT JOIN cstCostEstimate postce ON pco.costEstimateID = postce.ID     -- post (actual)
WHERE o.jobnumber IN (@jobs...)
```

### Cost Formulas

Per-unit costs in `cstCostEstimate` are stored **per 1000 units**, so divide by 1000 first:

```
estMaterialCost = (pce.materialcost / 1000) * adjustedQty
actMaterialCost = (postce.materialcost / 1000) * adjustedQty
```

Same pattern for `labourcost` and `freightcost`.

### Variance

```
variance = estimated - actual
```

- **Positive** variance = under budget (green)
- **Negative** variance = over budget (red)

## Estimated Hours

### Why Not ebxRoute

The original implementation joined through `cstCostEstimate.productDesignID → ebxRoute.productDesignID → espMachineRouteStep`. This was wrong because `ebxRoute` can have **hundreds of route revisions** per product design (e.g., job 14457 had 191 routes and 640 routing steps). This massively inflated estimated hours.

### Correct Join: espOrder.routeID

Each `espOrder` has a `routeID` column that points directly to the order's assigned route:

```sql
espOrder o
  INNER JOIN espMachineRouteStep rs ON rs.routeID = o.routeID
```

This gives exactly the routing steps assigned to that specific order — no revision explosion.

### Corrugator Machine Filter

Routing steps include ALL machines in the production line (board supply, corrugator, converting, folder gluer, strapper, etc.). We only want corrugator steps because order hours only measure corrugator time:

```sql
AND rs.machineno IN (130, 131, 132, 133, 142, 144, 146, 154)
```

ESP machine numbers directly correspond to KDW cost center numbers.

### Alternative Machine Deduplication

At the same routing sequence number, there can be multiple **alternative machines** (e.g., seq 2 might list machines 130, 131, and 133 as alternatives — only one actually runs the job). To avoid summing all alternatives:

```sql
GROUP BY o.jobnumber, rs.sequencenumber
```

We take `MAX(runRate)` and `MIN(setupMins)` per sequence to pick the best-case alternative.

### Full Routing Steps Query

```sql
SELECT
  o.jobnumber as jobNumber,
  rs.sequencenumber as seq,
  MAX(COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0)) as runRate,
  MIN(COALESCE(rs.routingstdsetupmins, rs.costingstdsetupmins, 0)) as setupMins
FROM espOrder o
  INNER JOIN espMachineRouteStep rs ON rs.routeID = o.routeID
WHERE o.jobnumber IN (@jobs...)
  AND o.routeID IS NOT NULL
  AND rs.machineno IN (130, 131, 132, 133, 142, 144, 146, 154)
  AND COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0) > 0
GROUP BY o.jobnumber, rs.sequencenumber
```

### Run Rate Priority

```
runRate = COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0)
setupMins = COALESCE(rs.routingstdsetupmins, rs.costingstdsetupmins, 0)
```

`routingstdrunrate` is preferred; falls back to `costingstdrunrate` if null.

### Estimated Hours Formula

Per job, sum across all corrugator routing steps:

```
stepHours = (setupMins / 60) + (1000 / runRate) * (totalAdjQty / 1000)
estimatedHours = SUM(stepHours) across all routing steps
```

Where `totalAdjQty` = total adjusted quantity for that job across all feedback rows.

### Per-Job Calculation with Proportional Distribution

Setup should be counted **once per job**, not once per feedback row. The implementation:

1. **Compute total adjQty per job** — sum `quantityProduced / machineCount` across all feedback rows for the job
2. **Compute total estimated hours per job** — using total adjQty, loop routing steps, sum step hours (setup + run)
3. **Distribute proportionally** — each feedback row gets `(rowAdjQty / totalAdjQty) * totalEstHours`

This ensures setup time isn't multiplied by the number of feedback rows when a job has multiple runs.

### Typical Routing Examples

**Single-machine job** (e.g., job 14485, routeID 27765):
| Seq | Machine | Run Rate | Setup Min | Used? |
|-----|---------|----------|-----------|-------|
| 1 | 1100 (Board Supply) | 999,999 | 0 | No — not a corrugator |
| 2 | 144 (Corrugator) | 4,463 | 15 | Yes |
| 3 | 9002 (Strapper) | 999,999 | 0 | No — not a corrugator |

Only seq 2 contributes to estimated hours.

**Two-machine job** (e.g., job 14338, routeID 22440):
| Seq | Machine | Run Rate | Setup Min | Used? |
|-----|---------|----------|-----------|-------|
| 2 | 130/133 (alternatives) | 1,765 | 31 | Yes — first corrugator pass |
| 3 | 154 | 3,400 | 48 | Yes — second corrugator pass |

Both seq 2 and seq 3 contribute to estimated hours. The `adjustedQty` (divided by machineCount=2) ensures the quantity isn't double-counted.

### When Estimated Hours Look Wrong

If estimated hours are significantly inflated or deflated for a job, the issue is almost certainly the **standard run rate** (`routingstdrunrate` / `costingstdrunrate`) in ESP. The quantity logic and routing joins have been validated. Check the `espMachineRouteStep` data for that job's route.

## Hours Variance

```
hoursVariance = orderHours - estimatedHours
```

- **Negative** = faster than estimated (green) — the corrugator finished ahead of schedule
- **Positive** = slower than estimated (red) — the corrugator took longer than expected

This is the inverse of cost variance coloring because for hours, less is better.

## API Endpoints

Base path: `/api/erp/cost-variance`

| Endpoint | Params | Returns |
|----------|--------|---------|
| `GET /date-limits` | none | `{ minDate, maxDate }` |
| `GET /summary` | `startDate`, `endDate`, `granularity`, `line?`, `customer?`, `spec?` | Array of period summaries |
| `GET /details` | `startDate`, `endDate`, `line?`, `customer?`, `spec?` | Job-level detail rows |
| `GET /filter-options` | `startDate`, `endDate`, `line?`, `customer?`, `spec?` | `{ lineNumbers[], customers[], specs[] }` |

### Summary Response Shape

```json
{
  "period": "2026-02-20",
  "estMaterialCost": 1234.56,
  "estLaborCost": 789.01,
  "estFreightCost": 234.56,
  "actMaterialCost": 1100.00,
  "actLaborCost": 850.00,
  "actFreightCost": 200.00,
  "orderHours": 45.2,
  "estimatedHours": 38.6
}
```

### Detail Response Shape

```json
{
  "feedbackDate": "2026-02-20",
  "jobNumber": "14485",
  "customerName": "Benchmark",
  "specNumber": "90517",
  "lineNumber": "144",
  "estMaterialCost": 500.00,
  "estLaborCost": 300.00,
  "estFreightCost": 100.00,
  "actMaterialCost": 480.00,
  "actLaborCost": 320.00,
  "actFreightCost": 90.00,
  "orderHours": 1.0,
  "estimatedHours": 0.4,
  "adjQty": 782,
  "stdRunRate": 4463,
  "setupMins": 15
}
```

`adjQty`, `stdRunRate`, and `setupMins` are exposed so users can trace the estimated hours calculation back to the routing data.

## Frontend Architecture

### State (persisted via localStorage, prefix `cost-var-dash:`)

| Key | Type | Default |
|-----|------|---------|
| `timeWindow` | `last-7 \| last-14 \| last-30 \| mtd \| qtd \| ytd` | `last-7` |
| `granularity` | `daily \| weekly \| monthly \| yearly` | `daily` |
| `chartTab` | `calendar \| area` | `area` |
| `costType` | `full \| material \| labor \| freight` | `full` |
| `lineFilter` | string | `all` |
| `customerFilter` | string | `all` |
| `specFilter` | string | `all` |
| `tableSort` | `{ key, dir }` | `{ feedbackDate, desc }` |
| `detailTab` | `costs \| hours` | `costs` |
| `hoursSort` | `{ key, dir }` | `{ feedbackDate, desc }` |
| `groupByDims` | string[] | all five dimensions |
| `calendarMonth` | `YYYY-MM` | current month |

### KPI Cards (6)

| KPI | Formula |
|-----|---------|
| Est Full Cost | SUM(estMaterial + estLabor + estFreight) |
| Act Full Cost | SUM(actMaterial + actLabor + actFreight) |
| Full Variance | Est Full - Act Full (green positive, red negative) |
| Material Variance | Est Material - Act Material |
| Labor Variance | Est Labor - Act Labor |
| Freight Variance | Est Freight - Act Freight |

### Chart Card

- **Area tab**: Two lines — Estimated (indigo `#6366f1` solid) vs Actual (violet `#a78bfa` dashed)
- **Calendar tab**: Variance heat map (green = under budget, red = over budget)
- Tabbed by cost type: Full | Material | Labor | Freight
- Granularity toggles (Y/M/W/D) on area tab only
- Click-to-select period narrows KPIs and detail table to that period

### Detail Table

Tabbed into **Costs** and **Hours** views. Both tabs share group-by dimension toggles (`Date`, `Job #`, `Customer`, `Spec`, `Line`) and `selectedPeriod` filtering.

**Costs tab** columns: Date, Job #, Customer, Spec, Line, Est Mat, Est Lab, Est Frt, Act Mat, Act Lab, Act Frt, Est Full, Act Full, Variance, Hrs

**Hours tab** columns: Date, Job #, Customer, Spec, Line, Adj Qty, Run Rate, Setup Min, Est Hours, Order Hours, Hours Var

Both tabs have: sortable headers, sticky header row, totals row at the bottom.

## Debugging & Tracing

### Tracing a specific job's routing

To investigate estimated hours for a job, query ESP directly:

```sql
-- Get the order's route ID
SELECT ID, jobnumber, routeID, precostestimateID, productdesignID
FROM espOrder WHERE jobnumber = '14485'

-- Get all routing steps for that route
SELECT rs.sequencenumber, rs.machineno,
  COALESCE(rs.routingstdrunrate, rs.costingstdrunrate, 0) as runRate,
  COALESCE(rs.routingstdsetupmins, rs.costingstdsetupmins, 0) as setupMins
FROM espMachineRouteStep rs
WHERE rs.routeID = 27765  -- from espOrder.routeID
ORDER BY rs.sequencenumber, rs.machineno
```

### Common Issues

| Symptom | Likely Cause |
|---------|-------------|
| Estimated hours wildly inflated | Run rate too low in `espMachineRouteStep`, or wrong route being used |
| Estimated hours = 0 | `espOrder.routeID` is NULL, or no corrugator machines in the routing |
| Cost variance all zeros | `precostestimateID` or post-costed order link is missing in ESP |
| adjQty looks halved | Job has 2-pass routing (expected behavior — see Machine Count section) |

## File Locations

| File | Purpose |
|------|---------|
| `apps/api/src/routes/cost-variance-dashboard.ts` | API route handlers + `computeCostVarianceRows()` |
| `apps/web/src/api/hooks/useCostVarianceDashboard.ts` | React Query hooks + TypeScript types |
| `apps/web/src/pages/erp/CostVarianceDashboard.tsx` | Frontend page component |
| `apps/web/src/lib/cost-engine.ts` | Reference implementation of estimated hours formula (lines 150-163) |
