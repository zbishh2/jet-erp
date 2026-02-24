# Dashboard UI Patterns

Reference implementation: `apps/web/src/pages/erp/SalesDashboard.tsx`

When building new dashboards, copy the Sales Dashboard and adapt it to new measures. This doc covers every detail of each section so you can reproduce the exact patterns.

---

## Page Container

```tsx
<div className="flex-1 overflow-y-auto px-6 pb-6 -mx-6 -mt-6 pt-3 space-y-4">
  {/* Header */}
  {/* KPI Cards */}
  {/* Charts Row */}
  {/* Detail Tables */}
</div>
```

- Negative margins (`-mx-6 -mt-6`) + padding (`px-6 pb-6 pt-3`) let the page fill the layout frame edge-to-edge
- `space-y-4` provides consistent 16px vertical gaps between sections
- `overflow-y-auto` makes the page scrollable independently

---

## Header

```tsx
<div className="flex items-center gap-3 pb-2 border-b border-border">
  {/* Back button */}
  <Button variant="ghost" size="icon" onClick={() => navigate("/erp")}>
    <ArrowLeft className="h-5 w-5" />
  </Button>

  {/* Title */}
  <span className="text-sm font-medium">Sales Dashboard</span>

  {/* Left-side pill buttons (quarter filter, active filter chip) */}
  <div className="flex items-center gap-1 ml-2">
    {quarters.map(q => (
      <Button
        variant={active ? "default" : "outline"}
        size="sm"
        className="h-7 px-2.5 text-xs"
      />
    ))}
    {/* Active filter chip with dismiss */}
    {selectedMonth && (
      <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs ml-1">
        {label} ✕
      </Button>
    )}
  </div>

  {/* Right-side dropdowns */}
  <div className="ml-auto flex items-center gap-2">
    <Select>
      <SelectTrigger className="w-[160px] h-8 text-xs" />
    </Select>
    <Select>
      <SelectTrigger className="w-[120px] h-8 text-xs" />
    </Select>
    {/* Conditional year picker */}
    <Select>
      <SelectTrigger className="w-[90px] h-8 text-xs" />
    </Select>
    {/* Reset button */}
    <Button variant="ghost" size="icon" className="h-8 w-8">
      <RotateCcw className="h-4 w-4" />
    </Button>
  </div>
</div>
```

### Data refresh pattern (optional)

If the dashboard supports manual refresh, add a refresh button and "Last refreshed" timestamp at the end of the right-side controls.

```tsx
const queryClient = useQueryClient()
const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
const [isRefreshing, setIsRefreshing] = useState(false)

const handleRefresh = useCallback(async () => {
  setIsRefreshing(true)
  try {
    await queryClient.invalidateQueries({ queryKey: ["dashboard-key"] })
    setLastUpdated(new Date())
  } finally {
    setIsRefreshing(false)
  }
}, [queryClient])

// Set initial timestamp once first data arrives
useEffect(() => {
  if (!lastUpdated && !summaryQuery.isLoading && summaryData.length > 0) {
    setLastUpdated(new Date())
  }
}, [lastUpdated, summaryQuery.isLoading, summaryData.length])

<div className="ml-auto flex items-center gap-2">
  {/* ...existing selects/buttons */}
  <Button
    variant="ghost"
    size="icon"
    className="h-8 w-8"
    onClick={handleRefresh}
    disabled={isRefreshing}
    title="Refresh data"
  >
    <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
  </Button>
  {lastUpdated && (
    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
      Last refreshed {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  )}
</div>
```

### Key specs
| Element | Size | Class |
|---------|------|-------|
| Back button | icon | `variant="ghost" size="icon"` |
| Title | — | `text-sm font-medium` |
| Pill buttons | 28px tall | `h-7 px-2.5 text-xs` |
| Select triggers | 32px tall | `h-8 text-xs` |
| Rep dropdown width | 160px | `w-[160px]` |
| Period dropdown width | 120px | `w-[120px]` |
| Year dropdown width | 90px | `w-[90px]` |
| Reset button | 32x32 | `h-8 w-8`, icon `h-4 w-4` |
| Refresh button | 32x32 | `h-8 w-8`, icon `h-4 w-4` |
| Last refreshed text | 11px | `text-[11px] text-muted-foreground whitespace-nowrap` |
| Bottom border | — | `pb-2 border-b border-border` |

### Pill toggle pattern
Use `variant="default"` for active and `variant="outline"` for inactive. Group in `flex items-center gap-1`.

---

## KPI Cards

```tsx
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
  <KpiCard title="..." value="..." description="..." trend={...} tooltip="..." />
</div>
```

### KpiCard component

```tsx
interface KpiCardProps {
  title: string
  value: string
  description?: string
  trend?: { value: number; isPositive: boolean }
  tooltip?: string
}

function KpiCard({ title, value, description, trend, tooltip }: KpiCardProps) {
  return (
    <Card className="bg-background-secondary">
      <CardContent className="p-4 h-full flex flex-col items-center justify-center text-center">
        {/* Title row with optional info icon */}
        <p className="text-sm font-medium text-muted-foreground inline-flex items-center gap-1">
          {title}
          {tooltip && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  className="max-w-[250px] text-xs bg-background-secondary text-foreground border border-border"
                >
                  <p>{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </p>

        {/* Value + trend */}
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-bold">{value}</p>
          {trend && (
            <span className={`flex items-center text-sm font-medium ${
              trend.isPositive ? 'text-green-500' : 'text-red-500'
            }`}>
              {trend.isPositive
                ? <TrendingUp className="h-4 w-4 mr-0.5" />
                : <TrendingDown className="h-4 w-4 mr-0.5" />}
              {Math.abs(trend.value)}%
            </span>
          )}
        </div>

        {/* Optional description */}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}
```

### Key specs
| Element | Class |
|---------|-------|
| Card background | `bg-background-secondary` |
| Padding | `p-4` |
| Layout | `h-full flex flex-col items-center justify-center text-center` |
| Title text | `text-sm font-medium text-muted-foreground` |
| Value text | `text-2xl font-bold` |
| Description text | `text-xs text-muted-foreground` |
| Info icon | `h-3.5 w-3.5 text-muted-foreground cursor-help` |
| Tooltip content | `max-w-[250px] text-xs bg-background-secondary text-foreground border border-border` |
| Trend icons | `h-4 w-4 mr-0.5` |
| Grid | `grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4` |

---

## Area Chart (Tabbed)

The area chart is the primary visualization. It lives in a `Card` spanning 2/3 width.

### Layout

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
  {/* Area chart — 2 cols */}
  <Card className="lg:col-span-2 bg-background-secondary">
    <Tabs defaultValue="sales">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          {/* Left: mode toggles + granularity */}
          <div className="flex items-center gap-3">
            {/* Mode toggle (Actual vs Budget / YOY) */}
            <div className="flex items-center gap-1">
              <Button variant={active ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" />
            </div>
            {/* Granularity toggle (Y / M / W) */}
            <div className="flex items-center gap-1">
              <Button variant={active ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs" />
            </div>
          </div>
          {/* Right: tabs */}
          <TabsList>
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="msf">MSF</TabsTrigger>
            {/* ... more tabs */}
          </TabsList>
        </div>
      </CardHeader>
      <CardContent>
        {/* Chart content per tab */}
      </CardContent>
    </Tabs>
  </Card>

  {/* Bar chart — 1 col */}
  <Card className="bg-background-secondary">...</Card>
</div>
```

### Granularity single-letter buttons
```tsx
<Button variant={active ? "default" : "outline"} size="sm" className="h-7 w-7 px-0 text-xs">
  {g[0].toUpperCase()} {/* "Y", "M", "W" */}
</Button>
```

### Loading state
```tsx
<div className="h-[300px] flex items-center justify-center">
  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
</div>
```

### Area chart structure (per tab)

Each tab follows this exact template. Only `dataKey`, `name`, gradient IDs, and formatter change.

```tsx
<ResponsiveContainer width="100%" height={300}>
  <AreaChart data={chartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
    <defs>
      <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
      </linearGradient>
      <linearGradient id="gradBudget" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.2} />
        <stop offset="95%" stopColor="#a78bfa" stopOpacity={0.02} />
      </linearGradient>
    </defs>
    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border" />
    <XAxis dataKey="label" className="text-xs" tickLine={false} />
    <YAxis tickFormatter={formatter} className="text-xs" />
    <RechartsTooltip
      formatter={(value, name) => [formattedValue, name]}
      contentStyle={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--border)",
        borderRadius: 8,
      }}
      labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
      itemStyle={{ color: "var(--color-text)" }}
    />
    <Legend />
    {/* Dim regions for period selection */}
    {dimRegions?.left && (
      <ReferenceArea x1={...} x2={...} fill="#000" fillOpacity={0.35} ifOverflow="visible" />
    )}
    {dimRegions?.right && (
      <ReferenceArea x1={...} x2={...} fill="#000" fillOpacity={0.35} ifOverflow="visible" />
    )}
    {/* Comparison line (budget or prior year) — rendered FIRST (behind) */}
    <Area
      type="monotone"
      dataKey={compKey}
      name={compLabel}
      stroke="#a78bfa"
      fill="url(#gradBudget)"
      strokeWidth={2}
      strokeDasharray="5 3"
      isAnimationActive={false}
    />
    {/* Primary line — rendered SECOND (on top) */}
    <Area
      type="monotone"
      dataKey="totalSales"
      name="Actual"
      stroke="#6366f1"
      fill="url(#gradActual)"
      strokeWidth={2.5}
      dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}
      isAnimationActive={false}
    >
      <LabelList dataKey="totalSales" content={renderAreaLabel(formatCurrency)} />
    </Area>
  </AreaChart>
</ResponsiveContainer>
```

### Color palette

| Role | Hex | Tailwind | Usage |
|------|-----|----------|-------|
| Primary (Actual) | `#6366f1` | indigo-500 | Stroke, dot fill, gradient |
| Comparison (Budget/PY) | `#a78bfa` | violet-400 | Stroke, gradient |
| Context (Prior Year on projection) | `#64748b` | slate-500 | Lightweight overlay line |
| Dim overlay | `#000` @ 0.35 | — | ReferenceArea for period selection |

### Gradient pattern

Gradients go from the series color to near-transparent:
- **Primary gradient**: `stopOpacity` 0.3 → 0.05
- **Comparison gradient**: `stopOpacity` 0.2 → 0.02

Each tab needs unique gradient IDs (e.g., `gradActual`, `gradActualMSF`, `gradActualCont`, `gradActualPMSF`).

### Data label renderer

Custom label positioning that shifts first/last labels to prevent clipping:

```tsx
const renderAreaLabel = useCallback((formatter: (v: number) => string, totalOverride?: number) => {
  const total = totalOverride ?? chartData.length
  return (props: any) => {
    const { x, y, value, index } = props
    if (value == null || !isFinite(x) || !isFinite(y)) return null
    const anchor = index === 0 ? "start" : index === total - 1 ? "end" : "middle"
    return (
      <text x={x} y={y - 10} fill="var(--color-text)" fontSize={11} textAnchor={anchor}>
        {formatter(value)}
      </text>
    )
  }
}, [chartData.length])
```

Key details:
- `y - 10` positions labels 10px above the data point
- `fontSize={11}` for data labels
- `fill="var(--color-text)"` for theme-aware label color
- `totalOverride` param is needed when a tab uses different data (e.g., projection chart has 12 points vs main chart's variable count)
- **Null guard**: `value == null || !isFinite(x) || !isFinite(y)` prevents crashes on null data points

### Chart specifications

| Property | Value |
|----------|-------|
| Height | `300` |
| Margins | `{ top: 20, left: 20, right: 30, bottom: 5 }` |
| CartesianGrid | `vertical={false} strokeDasharray="3 3" className="stroke-border"` |
| XAxis | `className="text-xs" tickLine={false}` |
| YAxis | `className="text-xs"` |
| Primary stroke width | `2.5` |
| Comparison stroke width | `2` |
| Comparison dash | `strokeDasharray="5 3"` |
| Dot (primary) | `{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }` |
| Dot (comparison) | none (default) |
| Animation | `isAnimationActive={false}` (always) |
| Cursor | `style={{ cursor: "pointer" }}` on AreaChart |

### Tooltip styling (all charts)

```tsx
contentStyle={{
  backgroundColor: "var(--color-bg-secondary)",
  borderColor: "var(--border)",
  borderRadius: 8,
}}
labelStyle={{ color: "var(--color-text)", fontWeight: 600 }}
itemStyle={{ color: "var(--color-text)" }}
```

### Period selection (click-to-filter)

Clicking a data point on the area chart toggles `selectedMonth`. Non-selected periods are dimmed with `ReferenceArea`:

```tsx
const dimRegions = useMemo(() => {
  if (!selectedMonth || chartData.length === 0) return null
  const idx = chartData.findIndex((d) => d.periodKey === selectedMonth)
  if (idx < 0) return null
  const labels = chartData.map((d) => d.label)
  return {
    left: idx > 0 ? { x1: labels[0], x2: labels[idx - 1] } : null,
    right: idx < labels.length - 1 ? { x1: labels[idx + 1], x2: labels[labels.length - 1] } : null,
  }
}, [selectedMonth, chartData])
```

### Weekly scrollable chart

When granularity is "weekly" and there are many data points:

```tsx
const maxVisiblePoints = 16
const needsScroll = granularity === "weekly" && chartData.length > maxVisiblePoints
const chartWidth = needsScroll ? chartData.length * 70 : undefined // 70px per week

// Wrapper:
<div ref={chartScrollRef} className={needsScroll ? "overflow-x-auto" : ""}>
  <div style={needsScroll ? { width: chartWidth } : undefined}>
    {/* chart */}
  </div>
</div>
```

Auto-scroll to the right (most recent data) on load:
```tsx
useEffect(() => {
  if (needsScroll && chartScrollRef.current) {
    chartScrollRef.current.scrollLeft = chartScrollRef.current.scrollWidth
  }
}, [needsScroll, chartData.length])
```

### Projection tab (special)

The projection tab uses a separate dataset (`projectionChartData`) with 12 months always. It renders outside the main IIFE but still inside the `<Tabs>` and `<CardContent>`:

```tsx
{!chartLoading && viewingCurrentYear && granularity === "monthly" && (
  <TabsContent value="projection" className="mt-0">
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={projectionChartData} margin={{ top: 20, left: 20, right: 30, bottom: 5 }}>
        {/* Same gradients/grid/axes/tooltip structure */}
        <Area dataKey="priorYear" name="Prior Year"
          stroke="#64748b" fill="none" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
        <Area dataKey="projected" name="Projected"
          stroke="#a78bfa" fill="url(#gradProjForecast)" strokeWidth={2} strokeDasharray="5 3"
          dot={{ r: 3, fill: "#a78bfa", stroke: "var(--color-bg)", strokeWidth: 1.5 }}>
          <LabelList dataKey="projected" content={renderAreaLabel(formatCurrency, 12)} />
        </Area>
        <Area dataKey="actual" name="YTD Sales"
          stroke="#6366f1" fill="url(#gradProjYTD)" strokeWidth={2.5}
          dot={{ r: 4, fill: "#6366f1", stroke: "var(--color-bg)", strokeWidth: 2 }}>
          <LabelList dataKey="actual" content={renderAreaLabel(formatCurrency, 12)} />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  </TabsContent>
)}
```

Key differences from standard tabs:
- No click handler (non-interactive)
- Three series: Prior Year (context), Projected (forecast), YTD Sales (actuals)
- `totalOverride=12` passed to `renderAreaLabel` since it always has 12 months
- Bridge point: last completed month has both `actual` and `projected` values so lines connect

---

## Bar Chart (Sales by Rep)

Horizontal bar chart in the right 1/3 column.

### Structure

```tsx
<Card className="bg-background-secondary">
  <CardHeader className="pb-2">
    <div className="flex items-center justify-between">
      <CardTitle className="text-base">Sales by Rep</CardTitle>
      {/* Manual legend */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />Actual
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[#a78bfa]" />Budget
        </span>
      </div>
    </div>
  </CardHeader>
  <CardContent className="p-0">
    <div className="px-4 pb-4">
      <div className="overflow-y-auto overflow-x-hidden max-h-[250px] cursor-pointer">
        <ResponsiveContainer width="100%" height={repBarHeight}>
          <BarChart data={repBarData} layout="vertical" margin={{ left: 10, right: 60 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={120} className="text-xs" tick={{ fontSize: 11 }} />
            <RechartsTooltip
              formatter={(value, name) => [formattedValue, name]}
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              itemStyle={tooltipItemStyle}
              cursor={{ fill: "var(--color-bg-hover)" }}
            />
            {/* Budget bar (behind) */}
            <Bar dataKey="budget" name="Budget" radius={[0, 2, 2, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={filtered && d.name !== activeRep ? "#a78bfa33" : "#a78bfa"} />
              ))}
            </Bar>
            {/* Actual bar (on top) */}
            <Bar dataKey="actual" name="Actual" radius={[0, 2, 2, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={filtered && d.name !== activeRep ? "#6366f133" : "#6366f1"} />
              ))}
              <LabelList
                dataKey="actual"
                position="right"
                fill="var(--color-text)"
                fontSize={11}
                formatter={(v) => formatCurrency(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  </CardContent>
</Card>
```

### Key specs

| Property | Value |
|----------|-------|
| Height | Dynamic: `Math.max(200, data.length * 34)` |
| Max visible height | `max-h-[250px]` with `overflow-y-auto` |
| Margins | `{ left: 10, right: 60 }` |
| Y-axis label width | `120` |
| Y-axis font | `tick={{ fontSize: 11 }}` |
| Bar radius | `[0, 2, 2, 0]` (right corners only) |
| Cursor | `{ fill: "var(--color-bg-hover)" }` |
| Label position | `"right"` |
| Label fill | `"var(--color-text)"` |
| Label fontSize | `11` |

### Click-to-filter interaction

The bar chart uses a click handler on the wrapper div (not Recharts' onClick) to calculate which rep was clicked based on cursor position:

```tsx
onClick={(e) => {
  const wrapper = e.currentTarget.querySelector('.recharts-wrapper')
  const rect = wrapper.getBoundingClientRect()
  const y = e.clientY - rect.top
  const topPad = 5
  const chartH = rect.height - topPad - 5
  const rowH = chartH / data.length
  const idx = Math.floor((y - topPad) / rowH)
  if (idx >= 0 && idx < data.length) {
    const name = data[idx].name
    setRepFilter(prev => prev === name ? "all" : name)
  }
}
```

### Dim unselected bars

When a rep is filtered, unselected bars use the color with `33` (20%) alpha appended:
- Active: `#6366f1` / `#a78bfa`
- Dimmed: `#6366f133` / `#a78bfa33`

### Manual legend (not Recharts Legend)

The bar chart uses a custom legend in the CardHeader instead of Recharts' `<Legend>`:
```tsx
<span className="flex items-center gap-1.5">
  <span className="h-2.5 w-2.5 rounded-sm bg-[#6366f1]" />Actual
</span>
```

---

## Detail Tables

Tables live in a `Card` below the charts row.

### Structure

```tsx
<Card className="bg-background-secondary">
  <CardHeader className="pb-2">
    <div className="flex items-center gap-3">
      <CardTitle className="text-base">Sales Detail</CardTitle>
      {/* Tab buttons */}
      <div className="flex items-center gap-1">
        <Button variant={active ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" />
      </div>
      {/* Conditional inline filters */}
    </div>
  </CardHeader>
  <CardContent className="p-0">
    <div className="relative overflow-x-auto max-h-[400px] overflow-y-auto [&>div]:!overflow-visible [&_td]:py-1.5 [&_th]:py-1.5">
      <Table>
        <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]">
          ...
        </TableHeader>
        <TableBody>
          {data.map(row => <TableRow>...</TableRow>)}
          {empty state row}
        </TableBody>
        {totals && (
          <TableFooter className="sticky bottom-0 z-10">
            <TableRow className="font-bold border-t-2">
              ...totals cells...
            </TableRow>
          </TableFooter>
        )}
      </Table>
    </div>
  </CardContent>
</Card>
```

### Sticky header + footer

The `<Table>` component (`components/ui/table.tsx`) wraps `<table>` in a `<div class="relative w-full">`. This div must **not** have `overflow-auto` — if it does, it becomes the scroll ancestor and sticky positioning breaks. The outer `max-h-[400px] overflow-y-auto` div must be the sole scroll container.

- **Headers**: Use `sticky top-0` on `<TableHeader>` or individual `<th>` elements.
- **Footer/totals**: Use `<TableFooter className="sticky bottom-0 z-10">` — renders as `<tfoot>` which has `bg-background-secondary` built in. Place it **after** `</TableBody>`, not inside it, so data rows scroll freely under the pinned footer.

### Key specs

| Property | Value |
|----------|-------|
| Max height | `max-h-[400px]` |
| Table wrapper overflow override | `[&>div]:!overflow-visible` |
| Cell padding override | `[&_td]:py-1.5 [&_th]:py-1.5` (compact rows) |
| Sticky header behavior | `[&_th]:sticky [&_th]:top-0 [&_th]:z-20` |
| Sticky header bg | `[&_th]:bg-[var(--color-bg-secondary)]` |
| Sticky footer | `<TableFooter className="sticky bottom-0 z-10">` (outside `<TableBody>`) |
| Sortable column header | `className="cursor-pointer hover:text-foreground"` + onClick |
| Sort indicator | `↑` / `↓` appended to header text |
| Empty state | `colSpan={N} className="text-center text-muted-foreground py-8"` |
| Numeric columns | `className="text-right"` |
| Truncated text columns | `className="font-medium max-w-[200px] truncate"` |

### Budget summary bar (above budget table)

```tsx
<div className="flex items-center gap-6 text-sm px-4 py-2 border-b border-border">
  <span className="text-muted-foreground">Work Days: <strong className="text-foreground">{value}</strong></span>
  <span className="text-muted-foreground">Completed: <strong className="text-foreground">{value}</strong></span>
  ...
</div>
```

### Conditional coloring (% to budget)

```tsx
<span className={
  pct >= 100 ? "text-green-500" :
  pct >= 75 ? "text-yellow-500" :
  "text-red-500"
}>
  {formatPercent(pct)}
</span>
```

### Dimmed rows (rep filter active)

```tsx
<TableRow className={repFilter !== "all" && r.repName !== repFilter ? "opacity-40" : ""}>
```

### Group-by dimension toggles

Allow users to collapse detail rows by toggling dimension columns on/off. When a dimension is removed, rows that share the same remaining dimension values are aggregated.

#### State

```tsx
const [groupByDims, setGroupByDims] = usePersistedState<string[]>(
  "groupByDims",
  ["feedbackDate", "jobNumber", "customerName", "specNumber", "lineNumber"]
)

const groupByDimOptions: [string, string][] = [
  ["feedbackDate", "Date"],
  ["jobNumber", "Job #"],
  ["customerName", "Customer"],
  ["specNumber", "Spec"],
  ["lineNumber", "Line"],
]

const dimLabels: Record<string, string> = {
  feedbackDate: "Feedback Date",
  jobNumber: "Job Number",
  customerName: "Customer Name",
  specNumber: "Spec",
  lineNumber: "Line Number",
}
```

#### Toggle UI (in card header)

```tsx
<CardHeader className="pb-2">
  <div className="flex items-center justify-between flex-wrap gap-2">
    <CardTitle className="text-base">Detail</CardTitle>
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground mr-1">Group by:</span>
      {groupByDimOptions.map(([dim, label]) => (
        <Button
          key={dim}
          variant={groupByDims.includes(dim) ? "default" : "outline"}
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => {
            setGroupByDims((prev) =>
              prev.includes(dim)
                ? prev.length > 0 ? prev.filter((d) => d !== dim) : prev
                : [...prev, dim]
            )
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  </div>
</CardHeader>
```

#### Aggregation logic

```tsx
const groupedDetailRows = useMemo(() => {
  const allDims = groupByDimOptions.map(([d]) => d)
  const activeDims = allDims.filter((d) => groupByDims.includes(d))
  if (activeDims.length === allDims.length) return detailRows // no grouping

  const grouped = new Map<string, typeof detailRows[number]>()
  for (const row of detailRows) {
    const key = activeDims.map((d) =>
      d === "feedbackDate" ? row.feedbackDate : (row as any)[d]
    ).join("|")
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        ...row,
        // Blank out inactive dims
        ...Object.fromEntries(allDims.filter(d => !activeDims.includes(d)).map(d => [d, ""])),
      })
    } else {
      // Sum additive fields, recompute derived fields
      existing.additiveField += row.additiveField
      existing.derivedField = /* recompute from sums */
    }
  }
  return [...grouped.values()]
}, [detailRows, groupByDims])
```

Key rules:
- **Short-circuit**: if all dims are active, return raw `detailRows` (no grouping overhead)
- **Group key**: pipe-join values of active dims only
- **First-seen row**: copy row, blank inactive dim fields to `""`
- **Subsequent rows**: sum additive fields, recompute derived ratios from running sums
- **Sort `groupedDetailRows`**, not raw `detailRows`

#### Dynamic columns

Only render `<TableHead>` and `<TableCell>` for active dims:

```tsx
{groupByDimOptions.map(([dim]) =>
  groupByDims.includes(dim) ? (
    <TableHead key={dim} ...>{dimLabels[dim]}</TableHead>
  ) : null
)}
{/* Metric columns always shown */}
```

Totals row uses `colSpan={groupByDims.length}` instead of a fixed number.

---

## State Management

### Persisted filter state

All filter state uses `usePersistedState` which stores to `localStorage` with a `sales-dash:` prefix:

```tsx
function usePersistedState<T>(key: string, defaultValue: T): [T, (val: T | ((prev: T) => T)) => void] {
  const storageKey = `sales-dash:${key}`
  // ... reads from localStorage on init, writes on every update
}
```

**For new dashboards**: Change the prefix from `sales-dash:` to something unique like `ops-dash:`.

Persisted states in the Sales Dashboard:
- `period` — TimePeriod ("ytd" | "last-year" | "this-month" | "custom")
- `year` — number
- `quarter` — Quarter ("all" | "Q1" | "Q2" | "Q3" | "Q4")
- `repFilter` — string ("all" or rep name)
- `customerSort` — `{ key: string; dir: "asc" | "desc" }`
- `chartMode` — "budget" | "yoy"
- `granularity` — "monthly" | "weekly" | "yearly"
- `tableTab` — "customer" | "rep" | "budget"
- `repSort` — `{ key: string; dir: "asc" | "desc" }`

Non-persisted:
- `selectedMonth` — `string | null` (resets on filter changes via useEffect)

### Reset filters

Always include a reset button that restores all persisted state to defaults:

```tsx
const resetFilters = useCallback(() => {
  setPeriod("custom")
  setYear(currentYear)
  // ... reset all persisted states
  setSelectedMonth(null) // also reset non-persisted
}, [currentYear, ...setters])
```

---

## Formatters

Copy these utility functions into new dashboards or extract to a shared module:

```tsx
function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

function formatCurrencyFull(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number, decimals = 0): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}
```

- `formatCurrency` — compact for labels (e.g. "$1.2M", "$350K")
- `formatCurrencyFull` — full for tooltips (e.g. "$1,234,567")
- Use `formatCurrency` for chart labels and KPI values
- Use `formatCurrencyFull` for tooltip formatters

---

## Theme / Color Rules

### Never hardcode text/background colors

Use CSS custom properties for anything that changes between light/dark mode:

| Use case | Value |
|----------|-------|
| Text fill (SVG/canvas) | `"var(--color-text)"` |
| Background (tooltip, card) | `"var(--color-bg-secondary)"` |
| Border | `"var(--border)"` or `"var(--color-border)"` |
| Dot stroke (white ring) | `"var(--color-bg)"` |
| Hover cursor fill | `"var(--color-bg-hover)"` |
| Sticky header | `[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-[var(--color-bg-secondary)]` |
| Sticky footer | `<TableFooter className="sticky bottom-0 z-10">` (inherits `bg-background-secondary`) |

### Chart series colors are OK as hex

The indigo/violet palette (`#6366f1`, `#a78bfa`, `#64748b`) are mid-range colors that read well on both light and dark backgrounds. Keep them as hardcoded hex values.

### CSS variable reference

See `apps/web/src/index.css` for the full list. Key variables:

| Variable | Light | Dark |
|----------|-------|------|
| `--color-bg` | `#ffffff` | `#0f1115` |
| `--color-bg-secondary` | `#f9fafb` | `#1a1d23` |
| `--color-bg-hover` | `#f3f4f6` | `#1e2128` |
| `--color-text` | `#111827` | `#f3f4f6` |
| `--color-text-secondary` | `#6b7280` | `#9ca3af` |
| `--color-border` | `#e5e7eb` | `rgba(255,255,255,0.08)` |

### Recharts className integration

Recharts components can use Tailwind classes via `className`:
- `className="stroke-border"` on `CartesianGrid` — uses the `border` color for grid lines
- `className="text-xs"` on `XAxis`/`YAxis` — sets tick label font size

### Focus ring removal

Add this to your global CSS to prevent ugly focus outlines on charts:

```css
.recharts-wrapper *:focus,
.recharts-wrapper *:focus-visible,
.recharts-wrapper:focus,
.recharts-wrapper:focus-visible {
  outline: none !important;
}

.recharts-wrapper,
.recharts-wrapper *,
.recharts-surface {
  outline: none !important;
  box-shadow: none !important;
  border: 0 !important;
  border-color: transparent !important;
}
```

---

## Imports Checklist

```tsx
// React Query (optional, for manual refresh pattern)
import { useQueryClient } from "@tanstack/react-query"

// Recharts
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, Legend, ResponsiveContainer,
  LabelList, Cell, ReferenceArea,
} from "recharts"

// shadcn/ui
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

// Icons
import { ArrowLeft, TrendingUp, TrendingDown, RotateCcw, RefreshCw, Info } from "lucide-react"
```

Note: Rename `Tooltip` from Recharts to `RechartsTooltip` to avoid collision with the shadcn/ui `Tooltip`. If manual refresh is not needed, omit `useQueryClient` and `RefreshCw`.
