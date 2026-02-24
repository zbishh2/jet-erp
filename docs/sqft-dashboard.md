# Sq Ft Dashboard — Technical Reference

Complete reference for the Square Footage production dashboard. This dashboard tracks corrugator throughput (square footage produced) and efficiency (sq ft per order hour) across production lines.

**Source of truth**: The Power BI project at `pbip/Contribution and Sq Ft by Line/` defines the canonical data model, measures, and calculations. When in doubt, defer to the PBIP `.tmdl` files.

---

## Files

| Layer | File | Purpose |
|-------|------|---------|
| **Frontend page** | `apps/web/src/pages/erp/SqFtDashboard.tsx` | Full dashboard UI (KPIs, charts, table) |
| **React Query hooks** | `apps/web/src/api/hooks/useSqFtDashboard.ts` | 5 hooks for the 5 API endpoints |
| **API routes** | `apps/api/src/routes/sqft-dashboard.ts` | Hono routes that build SQL and query Kiwiplan gateway |
| **Route mount** | `apps/api/src/app.ts` | Mounted at `/erp/sqft` → `erpApp.route('/sqft', sqFtDashboardRoutes)` |
| **Page route** | `apps/web/src/App.tsx` | `<Route path="/erp/sqft" element={<SqFtDashboard />} />` |
| **Sidebar nav** | `apps/web/src/components/layout/Sidebar.tsx` | Listed under "Production" section |
| **PBIP model** | `pbip/Contribution and Sq Ft by Line/...SemanticModel/definition/tables/dwproductionfeedback.tmdl` | Canonical computed columns and measures |

---

## Data Model

### Source Tables (Kiwiplan Data Warehouse — `kdw` database)

```
dwproductionfeedback (pf)     — One row per production run/feedback entry
  ├─ feedback_job_series_step_id  →  dwjobseriesstep.job_series_step_id
  ├─ feedback_costcenter_id       →  dwcostcenters.costcenter_id
  ├─ feedback_pcs_order_id        →  dwproductionorders.pcs_order_id
  ├─ feedback_report_date         — Date of the production run
  ├─ entry_width                  — Board width in 1/16th inches
  ├─ entry_length                 — Board length in 1/16th inches
  └─ quantity_fed_in              — Number of pieces/boxes produced

dwjobseriesstep (jss)          — Timing data per production step
  ├─ job_series_step_id
  ├─ feedback_start               — Run start timestamp
  └─ feedback_finish              — Run end timestamp

dwcostcenters (cc)             — Production line definitions
  ├─ costcenter_id
  ├─ costcenter_number            — Numeric line ID (e.g. 130, 131)
  └─ costcenter_number_and_name   — "130 - Corrugator" format

dwproductionorders (po)        — Order/job metadata
  ├─ pcs_order_id
  ├─ job_number
  ├─ customer_name
  └─ spec_number
```

### Joins

```sql
FROM dwproductionfeedback pf
INNER JOIN dwjobseriesstep jss
  ON pf.feedback_job_series_step_id = jss.job_series_step_id
INNER JOIN dwcostcenters cc
  ON pf.feedback_costcenter_id = cc.costcenter_id
LEFT JOIN dwproductionorders po
  ON pf.feedback_pcs_order_id = po.pcs_order_id
```

- `jss` is INNER JOIN because every feedback entry must have timing data
- `po` is LEFT JOIN because some entries may not have an associated production order

### Base Filter (applied to ALL queries)

```sql
WHERE cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
```

These are the corrugator lines. This matches the PBIP's Power Query `#"Filtered Rows"` step. **No other row-level exclusions** (no setup flag filter, no zero-duration filter) — the PBIP includes all feedback rows for these cost centers.

---

## Calculations

All calculations must match the PBIP computed columns exactly. The PBIP definitions live in `dwproductionfeedback.tmdl`.

### Sq Ft per Box

Converts board dimensions from 1/16th inches to feet, then multiplies for area.

| PBIP (DAX) | SQL |
|-------------|-----|
| `[entry_width] / 16 / 12 * [entry_length] / 16 / 12` | `(entry_width / 192.0) * (entry_length / 192.0)` |

Note: `16 * 12 = 192`. The SQL uses a single division for efficiency.

### Sq Ft Entry (total sq ft)

Total square footage for a production run.

| PBIP (DAX) | SQL |
|-------------|-----|
| `[Sq Ft per Box] * [quantity_fed_in]` | `(entry_width / 192.0) * (entry_length / 192.0) * quantity_fed_in` |

The aggregate measure `Sq Ft Entry` = `SUM(dwproductionfeedback[total sq ft])`.

### Order Hours

Time duration of the production run in hours.

| PBIP (DAX) | SQL |
|-------------|-----|
| `DATEDIFF([Order Start], [Order Finish], SECOND) / 60 / 60` | `DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) / 3600.0` |

`Order Start` and `Order Finish` are RELATED columns pulling `feedback_start` / `feedback_finish` from `dwjobseriesstep`.

### Derived Measures (computed on frontend)

| Measure | Formula | Format |
|---------|---------|--------|
| **Sq Ft Entry** | `SUM(sqFtEntry)` | `#,0` (integer) |
| **Sq Ft Per Day** | `SUM(sqFtEntry) / COUNT(DISTINCT dates)` | `#,0.00` (2 decimals) |
| **Sq Ft per Order Hour** | `SUM(sqFtEntry) / SUM(orderHours)` | `#,0.00` (2 decimals) |
| **Order Hours** | `SUM(orderHours)` | `0.0` (1 decimal) |

These are computed client-side from the summary API response, not in SQL. The API returns raw `sqFtEntry`, `orderHours`, and `dayCount` per period; the frontend divides.

### Line Number

| PBIP (DAX) | SQL |
|-------------|-----|
| `LEFT([costcenter_number_and_name], 3)` | `CAST(cc.costcenter_number AS VARCHAR(3))` |

Functionally equivalent — the first 3 chars of "130 - Corrugator" is "130".

---

## API Endpoints

All routes are prefixed `/api/erp/sqft/`. All except `date-limits` require `startDate` and `endDate` query params. Optional filters: `line`, `customer`, `spec`.

### GET `/date-limits`

Returns the min/max `feedback_report_date` across all data (no date filter applied). Used to set the time window bounds.

```json
{ "data": [{ "minDate": "2023-01-02", "maxDate": "2026-02-20" }] }
```

### GET `/summary`

Aggregated metrics grouped by time period. Additional param: `granularity` (`daily` | `weekly` | `monthly` | `yearly`).

```json
{
  "data": [
    { "period": "2026-01", "sqFtEntry": 1234567.89, "orderHours": 456.78, "dayCount": 22 }
  ]
}
```

Period format depends on granularity:
- `daily`: `"2026-01-15"` (individual date, ISO format)
- `yearly`: `"2026"`
- `monthly`: `"2026-01"`
- `weekly`: `"2026-01-06"` (Monday of the week, ISO format)

Weekly period expression uses Sunday-start weeks:
```sql
DATEADD(DAY, -(DATEDIFF(DAY, '19000107', date) % 7), date)
```

### GET `/by-line`

Sq Ft Entry and Order Hours aggregated by production line number. Used for the horizontal bar chart.

```json
{
  "data": [
    { "lineNumber": "130", "sqFtEntry": 500000.0, "orderHours": 200.5 }
  ]
}
```

### GET `/details`

Row-level detail grouped by date + job + customer + spec + line. Used for the detail table.

```json
{
  "data": [
    {
      "feedbackDate": "2026-02-20",
      "jobNumber": "J12345",
      "customerName": "Acme Corp",
      "specNumber": "SP100",
      "lineNumber": "130",
      "sqFtEntry": 12345.67,
      "sqFtPerBox": 8.5,
      "orderHours": 2.3
    }
  ]
}
```

- `sqFtPerBox` uses `AVG()` (not SUM) since it's a per-unit metric
- `sqFtPerOrderHour` is computed client-side as `sqFtEntry / orderHours`
- When a chart period is selected, the detail query narrows to that period's date range

### GET `/filter-options`

Returns distinct values for the three filter dropdowns, scoped to current date range. Each filter's options are computed independently of its own value (so selecting line 130 doesn't remove 130 from the line dropdown) but ARE cross-filtered by the other two filters.

```json
{
  "data": {
    "lineNumbers": ["130", "131", "132", ...],
    "customers": ["Acme Corp", "Beta Inc", ...],
    "specs": ["SP100", "SP200", ...]
  }
}
```

---

## Frontend Architecture

### State Management

All filter state uses `usePersistedState` with prefix `sqft-dash:` (localStorage-backed).

| State | Type | Default | Persisted |
|-------|------|---------|-----------|
| `timeWindow` | `"all-time" \| "last-qtr" \| "last-year" \| "qtd" \| "ytd"` | `"ytd"` | Yes |
| `granularity` | `"weekly" \| "monthly" \| "yearly"` | `"weekly"` | Yes |
| `chartTab` | `"calendar" \| "area"` | `"calendar"` | Yes |
| `areaMetric` | `"sqFtPerOrderHour" \| "sqFtEntry"` | `"sqFtPerOrderHour"` | Yes |
| `calendarMonth` | `"YYYY-MM"` | current month | Yes |
| `lineFilter` | `string` | `"all"` | Yes |
| `customerFilter` | `string` | `"all"` | Yes |
| `specFilter` | `string` | `"all"` | Yes |
| `tableSort` | `{ key, dir }` | `{ key: "feedbackDate", dir: "desc" }` | Yes |
| `selectedPeriod` | `string \| null` | `null` | No (resets on filter change) |

### Data Flow

```
Time Window + Date Limits → startDate / endDate
    ├─ summaryQuery(startDate, endDate, granularity, filters)  → chartData → KPIs + Area Chart
    ├─ calendarQuery(monthStart, monthEnd, "daily", filters)   → calendarMap → Calendar Heat Map
    ├─ byLineQuery(startDate, endDate, filters)                → barData   → Horizontal Bar Chart
    ├─ filterOptionsQuery(startDate, endDate, filters)         → dropdowns
    └─ detailsQuery(detailStart, detailEnd, filters)           → table rows
                     ↑
         narrowed by selectedPeriod (chart/calendar click)
```

When a user clicks a period on the area chart:
1. `selectedPeriod` is set to that period key
2. KPIs recalculate to show only that period's totals
3. Detail table date range narrows to that period
4. Dim regions overlay the unselected periods on the chart
5. Clicking the same period again deselects it

### UI Sections

1. **Header**: Back button, title, time window pills, filter dropdowns, reset, refresh
2. **KPI Cards**: 4 cards in a `grid-cols-2 lg:grid-cols-4` grid
3. **Charts Row**: `grid-cols-1 lg:grid-cols-3` — area chart (2 cols) + bar chart (1 col)
4. **Detail Table**: Full-width card with sortable columns and totals row

### Chart Details

**Main chart card (two tabs)**:
- Left side: "Sq Ft Trend" title + [Calendar | Area] tabs + month navigation (calendar only)
- Right side: Y/M/W granularity toggle (area only) + Sq Ft / Hr | Sq Ft Entry metric toggle (both tabs)

**Calendar tab**:
- Monthly heat map grid: 7 columns (Sun–Sat), dynamic row count based on month
- Indigo heat map gradient (`#e0e1fc` → `#6366f1`), matching app color scheme
- Empty cells (outside month) show subtle bordered placeholders
- Month navigation arrows (`< Month YYYY >`) on the header left
- Fires separate `useSqFtSummary` with `daily` granularity scoped to the viewed month
- Metric toggle switches between Sq Ft Entry and Sq Ft per Order Hour values
- Click a day cell to filter KPIs + detail table to that day
- Compact value formatting: `1.01M`, `880.7K`, etc.

**Area tab**:
- Single area chart, metric selected by Sq Ft / Hr | Sq Ft Entry toggle
- Granularity toggle (Y/M/W) controls period grouping
- Monthly X axis labels use short month names (`Jan '26`, `Feb '26`)
- Click-to-select period interaction with dim regions
- Weekly mode: horizontal scroll when >16 data points (70px per point), auto-scrolls to latest

**Bar Chart**:
- Horizontal bar chart showing `sqFtPerOrderHour` by line number
- Sorted descending by value (client-side)
- Click a bar to filter all views to that line (toggles `lineFilter`)
- Dimmed bars for unselected lines (`#6366f133` vs `#6366f1`)

### Number Formatting

| Column / KPI | Decimals | Example |
|-------------|----------|---------|
| Sq Ft Entry (KPI) | 0 | `1,234,567` |
| Sq Ft Per Day (KPI) | 2 | `56,123.45` |
| Sq Ft per Order Hour (KPI) | 2 | `2,345.67` |
| Order Hours (KPI) | 1 | `456.7` |
| Sq Ft Entry (table) | 0 | `12,345` |
| Sq Ft per Box (table) | 1 | `8.5` |
| Sq Ft per Order Hour (table) | 2 | `5,432.10` |
| Order Hours (table) | 1 | `2.3` |

### Detail Table Totals Row

- **Sq Ft Entry**: Sum of all visible rows
- **Sq Ft per Box**: Average across rows (not sum — it's a per-unit metric)
- **Sq Ft per Order Hour**: Weighted ratio `totalSqFtEntry / totalOrderHours`
- **Order Hours**: Sum of all visible rows

---

## PBIP Cross-Reference

The Power BI report has 3 Sq Ft pages (Weekly, Monthly, Calendar). The React dashboard combines Weekly and Monthly into a single view with granularity toggle.

### Differences from PBIP (intentional)

| PBIP | React Dashboard | Reason |
|------|-----------------|--------|
| Combo chart (columns + line overlay) | Tabbed area charts | Cleaner UX, matches app design system |
| Red (#C80424) column + black line colors | Indigo (#6366f1) area fill | Consistent with app-wide chart palette |
| Calendar/heat map page | Calendar tab on area chart card | Green heat map, month navigation, click-to-filter |
| Separate Weekly/Monthly pages | Single page with Y/M/W toggle | Better UX |

### PBIP Measures Location

All measures are defined in:
- `pbip/.../definition/tables/.Measures.tmdl` — DAX measures (Sq Ft Entry, Sq Ft per Order Hour, Sq Ft Per Day, Order Hours, Days)
- `pbip/.../definition/tables/dwproductionfeedback.tmdl` — Computed columns (Order Hours, Width in feet, Length in feet, Sq Ft per Box, total sq ft, Line Number, Order Start, Order Finish)

### PBIP Relationships

The key relationship for this dashboard:
```
dwproductionfeedback.feedback_job_series_step_id → dwjobseriesstep.job_series_step_id
```

This enables the RELATED() lookups for `feedback_start` / `feedback_finish` which power the Order Hours calculation. In SQL this is the `INNER JOIN dwjobseriesstep jss` clause.

---

## Common Pitfalls

1. **Do NOT add setup/zero-duration filters.** The PBIP includes all rows for the specified cost centers. Adding `job_setup_flag = 0` or `actual_run_duration_minutes != 0` will cause numbers to diverge from Power BI.

2. **Sq Ft per Box is a per-unit metric.** Use `AVG()` in SQL aggregation and average in the totals row. Never `SUM()` — summing per-unit values is meaningless.

3. **KPI decimal precision matters.** Sq Ft Per Day and Sq Ft per Order Hour show 2 decimals. Sq Ft Entry shows 0. Order Hours shows 1. These match the PBIP format strings.

4. **The API and web deploy separately.** SQL/calculation changes require `npm run deploy:api`. UI-only changes require `npm run deploy:web`. Use `npm run deploy` for both.

5. **Width/length units are 1/16th inches.** Divide by 192 (= 16 * 12) to get feet. The PBIP does `/ 16 / 12` in two steps; the SQL does `/ 192.0` in one step. Same result.

6. **filter-options cross-filtering.** Each dropdown's options are filtered by the OTHER two dropdowns but not by itself. This requires 3 separate queries with different filter combinations.
