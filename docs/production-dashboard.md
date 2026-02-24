# Production Dashboard

Reference implementation: `apps/web/src/pages/erp/ProductionDashboard.tsx`

This dashboard visualizes OEE (Overall Equipment Effectiveness) metrics from the Kiwiplan Data Warehouse (KDW). It has four tabs: **Quality**, **Speed**, **Uptime**, and **OEE** (which composes all three).

---

## Architecture

```
Browser (React)                    Cloudflare Worker (Hono)           On-prem gateway
ProductionDashboard.tsx  ──API──>  production-dashboard.ts  ──SQL──>  kiwiplan-gateway
  useProductionDashboard hooks       rawQuery(sql, params, 'kdw')       SQL Server (kdw_master)
```

### Files

| Layer | File | Purpose |
|-------|------|---------|
| API routes | `apps/api/src/routes/production-dashboard.ts` | SQL queries + Hono route handlers |
| React hooks | `apps/web/src/api/hooks/useProductionDashboard.ts` | React Query hooks + TypeScript interfaces |
| UI component | `apps/web/src/pages/erp/ProductionDashboard.tsx` | Full dashboard (~2400 lines) |
| Sidebar nav | `apps/web/src/components/layout/Sidebar.tsx` | Entry at `/erp/production` |

---

## Data Source

All queries run against **SQL Server** via the Kiwiplan Gateway (`kdw_master` database).

### Key Tables

| Table | Alias | Purpose |
|-------|-------|---------|
| `dwproductionfeedback` | `pf` | One row per production run (qty produced, qty fed, run duration, setup duration) |
| `dwjobseriesstep` | `jss` | Job/step metadata (job number, shift/crew_id, feedback_start/finish, number_up) |
| `dwcostcenters` | `cc` | Machine info (costcenter_number, name, optimum_run_speed) |
| `dwwaste` | `w`/`wps` | Waste records per step (waste_property, wasted_quantity, waste_code) |
| `dwdowntimes` | `d`/`dt` | Downtime events (duration, class_name, closed_flag, downtime_within) |
| `dwproductionorders` | `po` | Order metadata (customer_name, spec_number) — used in speed detail only |

### Standard Joins

```sql
FROM dwproductionfeedback pf
INNER JOIN dwjobseriesstep jss ON pf.feedback_job_series_step_id = jss.job_series_step_id
INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
```

### Standard Filters

All queries include:
- `pf.actual_run_duration_minutes != 0` — exclude zero-duration feedback
- `cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)` — only these 8 machines
- Date range: `pf.feedback_report_date >= @startDate AND pf.feedback_report_date < @endDate`
- Optional: `cc.costcenter_number = @machine` and `jss.crew_id = @shift`

---

## Formulas

### Quality

| Metric | Formula |
|--------|---------|
| Produced Sheets | `quantity_produced * number_up_exit_1 / number_up_entry_1` |
| Reported Waste | `SUM(wasted_quantity) WHERE waste_property != 0`, capped at 200,000 per step |
| Prerun Waste | `pf.prerun_waste` (waste_property = 1 in dwwaste) |
| Quality % | `Produced Sheets / (Produced Sheets + Reported Waste) * 100` |
| Waste % | `Reported Waste / (Produced Sheets + Reported Waste) * 100` |

### Speed

| Metric | Formula |
|--------|---------|
| Order Hours | `DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) / 3600` |
| Run Hours | `Order Hours - Setup Hours` |
| Uptime Hours | `Run Hours - Total Downtime + Setup Downtime` (see `UPTIME_HOURS_EXPR` below) |
| Sheets Per Hour | `Total Fed In / Uptime Hours` |
| Speed to Optimum % | `Sheets Per Hour / Optimum Run Speed * 100` |
| Actual Speed | `quantity_fed_in / (actual_run_duration_seconds / 3600)` |

**UPTIME_HOURS_EXPR** (shared SQL expression):
```sql
(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) - CAST(pf.setup_duration_seconds AS FLOAT))
/ 3600.0
+ ISNULL(dt.setupDowntimeHours, 0)
- ISNULL(dt.totalDowntimeHours, 0)
```

### Uptime

| Metric | Formula |
|--------|---------|
| Setup Hours | `setup_duration_seconds / 3600 - setupDowntimeHours` |
| Run Hours | `Order Hours - Setup Hours` |
| Uptime Hours | `Run Hours - Downtime Open - Downtime Closed` |
| Uptime % | `Uptime Hours / Run Hours * 100` |
| Downtime Open | Total hours where `downtime_closed_flag = 0` |
| Downtime Closed | Total hours where `downtime_closed_flag = 1` |

### OEE

```
OEE % = Quality % x Speed % x Uptime %
      = (Q/100) * (S/100) * (U/100) * 100
```

OEE is computed client-side by composing quality, speed, and uptime query results. It is NOT a separate SQL query — the summary, by-machine, and by-shift data are merged by matching on `period`, `machineNumber`, or `shiftName`.

---

## ABOVE_OPTIMUM_FILTER

Speed and Uptime queries (but NOT Quality) exclude rows where the per-row actual speed exceeds the machine's optimum run speed. This matches the Power BI "Final Speed Rating" filter.

```sql
AND (
  CASE
    WHEN cc.costcenter_number = 131
      AND MONTH(pf.feedback_report_date) = 6
      AND YEAR(pf.feedback_report_date) = 2025
    THEN 1  -- Exception: always include Machine 131 in June 2025
    WHEN cc.costcenter_number = 154
      AND actualSpeed > 15000
    THEN 0  -- Machine 154 uses 15,000 as its cap (not cc.optimum_run_speed)
    WHEN cc.costcenter_number != 154
      AND actualSpeed > cc.optimum_run_speed
    THEN 0  -- All other machines: exclude if above optimum
    ELSE 1
  END = 1
)
```

The **Speed Exceptions** endpoint returns the inverse — rows that FAIL this check — so users can see what was filtered out.

---

## API Endpoints

All routes are mounted at `/api/erp/production/` via `productionDashboardRoutes`.

### Summary (time-series) endpoints

| Endpoint | Params | Returns | Tab |
|----------|--------|---------|-----|
| `GET /quality-summary` | startDate, endDate, granularity, machine?, shift? | `QualitySummary[]` | Quality |
| `GET /speed-summary` | startDate, endDate, granularity, machine?, shift? | `SpeedSummary[]` | Speed |
| `GET /uptime-summary` | startDate, endDate, granularity, machine?, shift? | `UptimeSummary[]` | Uptime |
| `GET /oee-summary` | startDate, endDate, granularity, machine?, shift? | `OeeSummary[]` | OEE |

Granularity: `monthly` (default), `weekly`, `yearly`. Period expression changes the GROUP BY.

### Breakdown endpoints

| Endpoint | Params | Returns | Tab |
|----------|--------|---------|-----|
| `GET /quality-by-machine` | startDate, endDate, shift? | `QualityByMachine[]` | Quality, OEE |
| `GET /quality-by-shift` | startDate, endDate, machine? | `QualityByShift[]` | Quality, OEE |
| `GET /speed-by-machine` | startDate, endDate, shift? | `SpeedByMachine[]` | Speed, OEE |
| `GET /speed-by-shift` | startDate, endDate, machine? | `SpeedByShift[]` | Speed, OEE |
| `GET /uptime-by-machine` | startDate, endDate, shift? | `UptimeByMachine[]` | Uptime, OEE |
| `GET /uptime-by-shift` | startDate, endDate, machine? | `UptimeByShift[]` | Uptime, OEE |
| `GET /oee-by-machine` | startDate, endDate, shift? | `OeeByMachine[]` | OEE |
| `GET /oee-by-shift` | startDate, endDate, machine? | `OeeByShift[]` | OEE |
| `GET /waste-by-category` | startDate, endDate, machine?, shift? | `WasteByCategory[]` | Quality |
| `GET /downtime-by-reason` | startDate, endDate, machine?, shift? | `DowntimeByReason[]` | Uptime |

### Detail (row-level) endpoints

| Endpoint | Params | Returns | Tab |
|----------|--------|---------|-----|
| `GET /quality-detail` | startDate, endDate, machine?, shift? | `QualityDetail[]` | Quality |
| `GET /speed-detail` | startDate, endDate, machine?, shift? | `SpeedDetail[]` | Speed |
| `GET /speed-exceptions` | startDate, endDate, machine?, shift? | `SpeedException[]` | Speed |
| `GET /uptime-detail` | startDate, endDate, machine?, shift? | `UptimeDetail[]` | Uptime |
| `GET /oee-detail` | startDate, endDate, machine?, shift? | `OeeDetail[]` | OEE |

### Reference data

| Endpoint | Returns |
|----------|---------|
| `GET /machines` | `Machine[]` (machineNumber, machineName) |
| `GET /shifts` | `Shift[]` (shiftName) |

---

## React Query Hooks

All hooks are in `apps/web/src/api/hooks/useProductionDashboard.ts`.

Each hook follows this pattern:
```typescript
export function useXxx(startDate, endDate, ...filters, enabled = true) {
  return useQuery({
    queryKey: ["production", "xxx", startDate, endDate, ...filterKeys],
    queryFn: () => apiFetch<{ data: Xxx[] }>(`/erp/production/xxx?${params}`),
    enabled: enabled && !!startDate && !!endDate,
    staleTime: 1000 * 60 * 5,  // 5 minutes
  })
}
```

The `enabled` parameter controls which queries fire based on the active tab:
- Quality tab: quality queries enabled
- Speed tab: speed queries + speed exceptions enabled
- Uptime tab: uptime queries + downtime-by-reason enabled
- OEE tab: quality + speed + uptime summaries and by-machine/by-shift all enabled

---

## Component State

### Persisted state (localStorage, prefix `production-dash:`)

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `period` | `"ytd" \| "last-year" \| "this-month" \| "custom"` | `"custom"` | Time period selector |
| `year` | `number` | current year | Year for "custom" period |
| `machineFilter` | `string` | `"all"` | Machine dropdown |
| `shiftFilter` | `string` | `"all"` | Shift dropdown |
| `granularity` | `"monthly" \| "weekly" \| "yearly"` | `"monthly"` | Chart granularity |
| `tab` | `"quality" \| "speed" \| "uptime" \| "oee"` | `"quality"` | Active dashboard tab |
| `tableTab` | `"machine" \| "shift"` | `"machine"` | OEE detail toggle |
| `tableSort` | `{ key, dir }` | `{ key: "producedSheets", dir: "desc" }` | Table sort state |
| `qualityChartTab` | `string` | `"quality"` | Quality chart sub-tab |
| `speedChartTab` | `string` | `"speedToOptimum"` | Speed chart sub-tab |
| `uptimeChartTab` | `string` | `"uptimePct"` | Uptime chart sub-tab |
| `oeeChartTab` | `string` | `"oeePct"` | OEE chart sub-tab |
| `exceptionsSort` | `{ key, dir }` | `{ key: "feedDate", dir: "desc" }` | Speed exceptions sort |

### Non-persisted state

| Variable | Purpose |
|----------|---------|
| `selectedPeriod` | Clicked chart period (narrows detail queries) |
| `lastUpdated` / `isRefreshing` | Refresh button state |
| `speedCustomerFilter`, `speedSpecFilter`, `speedJobFilter` | Speed detail slicers |
| `speedCustomerSearch`, `speedSpecSearch`, `speedJobSearch` | Slicer search text |
| `customerPopoverOpen`, `specPopoverOpen`, `jobPopoverOpen` | Slicer popover state |
| `exceptionsOpen` | Speed exceptions collapse state |

### State reset behavior

- Changing `period`, `year`, `granularity`, `machineFilter`, `shiftFilter`, or `dashboardTab` resets `selectedPeriod` and all speed detail slicers via a `useEffect`.
- The reset button (`resetFilters`) restores everything to defaults.

---

## UI Layout

### Header
Back button | "Production Dashboard" | Tab pills (Quality/Speed/Uptime/OEE) | Selected period chip | Machine dropdown | Shift dropdown | Period dropdown | Year dropdown | Reset | Refresh + timestamp

### Per-Tab Content

Each tab has:
1. **KPI Cards** — 5-7 cards in a responsive grid
2. **Charts Row** — Area chart (2/3 width) + Bar chart (1/3 width)
3. **Detail Table** — Row-level data in a sortable, scrollable table

### Quality Tab

- **KPIs**: Quality %, Produced Sheets, Waste Sheets, Waste %, Produced Qty, Fed Qty
- **Area chart tabs**: Quality % | Waste % | Produced Sheets | Waste Sheets | Produced Qty | Fed Qty
- **Bar chart**: "Waste by Category" — horizontal bars by waste_code
- **Detail table**: Week Start Date, Date, Job #, Reported Waste, Prerun Waste, Produced Sheets, Quality %

### Speed Tab

- **KPIs**: Speed to Optimum %, Sheets Per Hour, Optimum Speed, Total Fed In, Uptime Hours
- **Area chart tabs**: Speed to Optimum % | Sheets Per Hour
- **Bar chart**: "Speed by Machine" — horizontal bars showing speed to optimum % per machine
- **Detail table**: 15 columns including Week Start, Line #, Date, Job, Customer, Spec, Speed to Optimum %, Speed to Order %, Sheets/Hr, Sheets/Order Hr, Uptime Hrs, Actual Speed, Optimum Speed, Order Hrs, Uptime %
  - **Searchable slicers**: Customer, Spec, and Job # (Popover + Input pattern)
- **Exceptions table**: Collapsible table of rows excluded by the ABOVE_OPTIMUM_FILTER (Date, Machine, Shift, Fed In, Run Hrs, Actual Speed, Optimum Speed, % Over)

### Uptime Tab

- **KPIs**: Uptime %, Uptime Hours, Run Hours, Order Hours, Setup Hours, Downtime Open, Downtime Closed
- **Area chart tabs**: Uptime % | Uptime Hours | Run Hours | Order Hours
- **Bar chart**: "Downtime by Reason" — horizontal bars by downtime_class_name
- **Detail table**: Week Start Date, Date, Job #, Setup Hours, Run Hours, Downtime Hours, Order Hours, Uptime Hours, Setup %, Uptime %, Downtime %

### OEE Tab

- **KPIs**: OEE %, Quality %, Speed %, Uptime %, Produced Sheets, Run Hours
- **Area chart tabs**: OEE % | Quality % | Speed % | Uptime %
- **Bar chart**: "OEE by Machine" — horizontal bars showing OEE % per machine
- **Detail table**: Row-level OEE breakdown — Date, Line, Job Num, Customer, Spec, Uptime %, Speed %, Quality %, OEE % (color-coded), Setup Count, Order Hrs

---

## SQL Architecture

### FROM clause helpers

The API file uses helper functions to build SQL:

| Function | Used by | Special joins |
|----------|---------|---------------|
| `qualityFromClause()` | Quality queries | LEFT JOIN dwwaste (aggregated per step) |
| `speedFromClause()` | Speed queries | LEFT JOIN dwdowntimes (total + setup breakdown) + ABOVE_OPTIMUM_FILTER |
| `uptimeFromClause()` | Uptime queries | LEFT JOIN dwdowntimes (setup + open/closed breakdown) + ABOVE_OPTIMUM_FILTER |
| `oeeFromClause()` | OEE queries | Both waste + downtime joins + CROSS APPLY speedFilter computed column |

### Granularity period expressions

| Granularity | SQL expression |
|-------------|---------------|
| monthly | `FORMAT(pf.feedback_report_date, 'yyyy-MM')` |
| weekly | `CONVERT(VARCHAR(10), DATEADD(DAY, 1 - DATEPART(WEEKDAY, pf.feedback_report_date), pf.feedback_report_date), 23)` |
| yearly | `FORMAT(pf.feedback_report_date, 'yyyy')` |

### CROSS APPLY pattern

Detail queries use `CROSS APPLY` to define computed columns (orderHours, runHours, uptimeHours, optimumSpeed) that are referenced multiple times:

```sql
CROSS APPLY (
  SELECT
    CAST(CASE WHEN cc.costcenter_number = 154 THEN 15000 ELSE cc.optimum_run_speed END AS FLOAT) as optimumSpeed,
    CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0 as orderHours,
    (...) as runHours,
    (...) as uptimeHours
) computed
```

Speed detail also uses `OUTER APPLY` to look up customer/spec from `dwproductionorders`:
```sql
OUTER APPLY (
  SELECT TOP 1 po2.customer_name, po2.spec_number
  FROM dwproductionorders po2
  WHERE po2.job_number = jss.feedback_job_number
) po
```

---

## Chart Interaction

### Click-to-filter (area chart)

Clicking a data point on the area chart sets `selectedPeriod` to that period's key. This:
1. Dims non-selected periods with `<ReferenceArea>` overlays
2. Narrows `detailStart`/`detailEnd` for detail queries (table shows only that period's data)
3. Recalculates KPIs to show only that period
4. Shows a dismissible chip in the header

### Click-to-filter (bar chart)

Bar charts use a click handler that calculates the clicked bar index from cursor position. Unselected bars are dimmed with `33` (20%) alpha suffix on the hex color.

### Color palette

| Role | Hex | Usage |
|------|-----|-------|
| Primary | `#6366f1` | Area stroke, bar fill, dots |
| Secondary | `#a78bfa` | Comparison line, secondary bars, exceptions |
| Dimmed | Append `33` to hex | Unselected bars |

---

## Searchable Slicer Pattern (Speed Detail)

The speed detail table has three searchable dropdown slicers (Customer, Spec, Job #) using the Popover + Input pattern:

```tsx
<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
  <PopoverTrigger asChild>
    <Button variant="outline" size="sm" className="h-7 px-2 text-xs min-w-[100px] justify-between">
      {filter !== "all" ? filter : "All"} <ChevronDown className="h-3 w-3 ml-1" />
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-[200px] p-2" align="start">
    <div className="relative mb-2">
      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input placeholder="Search..." value={search} onChange={...} className="h-7 pl-7 text-xs" />
    </div>
    <div className="max-h-[200px] overflow-y-auto space-y-0.5">
      <button onClick={() => { setFilter("all"); setPopoverOpen(false) }}>All</button>
      {filteredOptions.map(opt => (
        <button onClick={() => { setFilter(opt); setPopoverOpen(false) }}>{opt}</button>
      ))}
    </div>
  </PopoverContent>
</Popover>
```

Slicer options are derived from unfiltered speed detail data. Filtering is client-side via `filteredSpeedDetailData` memo.

---

## Adding a New Metric/Tab

1. **API**: Add SQL query to `PRODUCTION_SQL` object + route handler in `production-dashboard.ts`
2. **Hook**: Add interface + `useXxx` hook in `useProductionDashboard.ts`
3. **UI**: Add KPI cards, chart data memo, chart tabs, bar chart data, and detail table in `ProductionDashboard.tsx`

Follow existing patterns for:
- FROM clause helpers with `hasMachine`/`hasShift` parameters
- Route handler boilerplate (client check, param parsing, error handling)
- Hook with `enabled` parameter for conditional fetching
- `usePersistedState` for new filter/sort state
- `sortTableData` for sortable columns
- Totals row computed from raw data array

---

## Known Gotchas

- **Linter strips unused code**: The project linter auto-removes unused imports and variables between saves. When adding new state/imports before their JSX usage, the linter may strip them. Add JSX usage first, or re-add stripped code after.
- **Machine 154 special case**: Uses hardcoded optimum speed of 15,000 instead of `cc.optimum_run_speed`.
- **Machine 131 June 2025 exception**: Always included in speed queries regardless of the ABOVE_OPTIMUM_FILTER.
- **Waste cap**: Waste per step is capped at 200,000. Steps with > 200k waste are treated as 0 waste (data quality issue).
- **OEE is client-composed**: There's no single OEE SQL query. OEE data is assembled in the browser by joining quality, speed, and uptime results by period/machine/shift.
- **SpeedByShift lacks optimumSpeed**: The speed-by-shift query doesn't return per-machine optimum speed. OEE shift calculations use the overall average from `speedKpis.avgOptimumSpeed`.
- **Recharts Tooltip conflict**: Import Recharts `Tooltip` as `RechartsTooltip` to avoid collision with shadcn/ui `Tooltip`.
- **Sticky table headers/footers**: The shadcn `<Table>` component wraps `<table>` in a `<div>`. That div must NOT have `overflow-auto` (removed in `table.tsx`), or it becomes the scroll ancestor and breaks `position: sticky`. The outer `max-h-[400px] overflow-y-auto` div is the scroll container. Totals rows use `<TableFooter className="sticky bottom-0 z-10">` placed after `</TableBody>`, not inside it.
- **OEE is also row-level**: The OEE detail table uses its own SQL query (`oeeDetail`) with per-row OEE computation via CROSS APPLY, unlike the OEE summary which is client-composed.
