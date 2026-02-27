// Knowledge base for the AI chatbot assistant.
// Each section is a user-facing guide about the ERP application.
// Total: ~13K tokens — fits comfortably in a single system prompt.

export const KNOWLEDGE_BASE = `
## App Overview

Jet Container's ERP is a web application for tracking sales, production, costs, and inventory at a corrugated box manufacturer. Data flows from Kiwiplan/ESP (the manufacturing ERP) into dashboards here.

### Sidebar Navigation

**Financial** (Finance & Admin roles)
- Sales Dashboard — revenue, MSF, margin, budget tracking
- Contribution Dashboard — production value minus cost, efficiency per order hour
- Cost Variance — estimated vs actual costs (material, labor, freight)

**Production** (all roles)
- OEE Dashboard — Overall Equipment Effectiveness (Quality × Speed × Uptime)
- Sq Ft Dashboard — corrugator throughput and efficiency
- MRP & Inventory — stock levels, demand forecast, months of supply

**Estimating** (Estimator & Admin roles)
- Quotes — quote creation and management
- Customers — customer records

**Admin** (Admin role only)
- SQL Explorer — direct database query tool
- User Management — invite, deactivate, role assignment

### Roles

| Role | Access |
|------|--------|
| ADMIN | Everything — all dashboards, SQL explorer, user management |
| FINANCE | Financial dashboards (Sales, Contribution, Cost Variance) + Production dashboards |
| ESTIMATOR | Estimating tools (Quotes, Customers) + Production dashboards |
| VIEWER | Production dashboards only (OEE, Sq Ft, MRP) |

### General Tips
- All dashboards remember your filter settings (time window, granularity, filters) between sessions
- Click on chart data points to drill down into that period
- Use the reset button (↻) to restore default filters
- Light/dark theme toggle is in the sidebar footer

---

## Glossary

### Manufacturing Terms
- **MSF** — Thousand Square Feet. Standard unit for measuring corrugated board area. Calculated as invoiced area ÷ 1,000.
- **OEE** — Overall Equipment Effectiveness. Composite metric: Quality% × Speed% × Uptime%. A score of 85%+ is world-class for corrugated.
- **Corrugator** — The machine that combines liner and fluting into corrugated board. Lines 130-154 in this plant.
- **Run rate** — Production speed, measured in sheets per hour.
- **Optimum speed** — The target/ideal speed for a given machine and product combination.
- **Uptime** — Hours the machine was actively producing (run hours minus downtime).
- **Downtime (open)** — Unplanned stoppages, typically mechanical issues.
- **Downtime (closed)** — Planned stoppages (scheduled maintenance, shift changes).
- **Setup hours** — Time spent preparing a machine for a new job (make-ready).
- **Order hours** — Total time from job start to job finish (includes setup + run + downtime).
- **Feedback** — Production data entry recorded by operators after each run.
- **Cost center** — A production line identified by number (e.g., 130 = Corrugator).
- **Spec / Spec number** — A product specification defining box dimensions, board grade, and print.
- **Number out** — How many boxes are cut from a single sheet on the die cutter.
- **Quantity fed in** — Number of sheets physically fed into the machine.

### Financial Terms
- **Margin** — Revenue minus Cost. Also called gross profit.
- **Margin %** — (Revenue - Cost) / Revenue × 100.
- **Contribution** — Calculated Value minus (Material + Labor + Freight costs). Measures how much a job contributes to overhead/profit.
- **Contribution %** — Contribution / Calculated Value × 100.
- **Calculated Value** — The total production value of a job based on cost estimates.
- **Pre-cost (estimated)** — Cost estimate made before production, from the quoting system.
- **Post-cost (actual)** — Real cost recorded after production completes.
- **Full cost** — Material + Labor + Freight combined.
- **Budget** — Annual sales target, tracked monthly and by rep.
- **% to Budget** — Actual / Budget × 100. Green ≥100%, yellow ≥75%, red <75%.

### Inventory Terms
- **MRP** — Material Requirements Planning. Projects future demand against current stock.
- **Months of Supply (MoS)** — On-hand quantity / average monthly usage. Shows how many months current stock will last.
- **On-hand** — Current inventory quantity in the warehouse.
- **Min Qty / Max Qty** — Reorder thresholds. Below Min triggers a replenishment alert.
- **Health states**: Shortage (red, on-hand ≤ 0), Below Min (yellow, on-hand < min qty), Good (green).
- **Projected balance** — Future inventory after accounting for scheduled production orders and expected demand.

---

## Sales Dashboard

### What It Shows
Revenue, square footage (MSF), margin, and budget performance across customers and sales reps.

### Navigation
Sidebar → Financial → Sales Dashboard (or /erp/sales)

### KPIs Explained
| KPI | What It Means |
|-----|---------------|
| Total Sales | Sum of invoice line values for the period |
| Contribution $ | Revenue minus estimated full cost |
| Contribution % | Contribution / Revenue × 100 |
| MSF | Thousand square feet of board invoiced |
| Sales $/MSF | Revenue per thousand sq ft (pricing efficiency) |
| Projected Annual | Extrapolated full-year revenue from the current run rate |

Each KPI card shows a trend arrow (▲/▼) comparing to the prior period.

### Charts
- **Area chart** (left 2/3): Trend over time with tabs for Sales ($), MSF, Contribution, $/MSF, and Projection
  - Toggle between "vs Budget" and "vs Year-over-Year" comparison modes
  - Granularity: Yearly / Monthly / Weekly
  - Click a data point to drill into that period
- **Bar chart** (right 1/3): Sales by Rep — horizontal bars showing Actual vs Budget per rep
  - Click a rep to filter the entire dashboard to that person

### Tables
- **Detail tab**: Every invoice line with Date, Job, Customer, Spec, Line, Sales, MSF, $/MSF, Cost, Contribution, Contribution%
  - Group-by toggles let you collapse dimensions (e.g., remove Date to see totals per customer)
- **Budget tab**: Budget vs Actual vs Projected for each metric, with % to Budget coloring

### Filters
- Time window presets (YTD, Last Year, Last 30 Days, custom range)
- Quarter filter (Q1-Q4 or All)
- Sales rep dropdown
- Customer dropdown
- Granularity (Y/M/W)

### Common Questions
**Q: Who are our top customers this month?**
→ Go to Sales Dashboard → set time window to current month → Detail tab → sort by Sales descending.

**Q: Are we on track for budget?**
→ Sales Dashboard → Budget tab shows Actual vs Projected vs Budget with % to Budget for every metric.

**Q: How does this year compare to last year?**
→ Sales Dashboard → toggle area chart to "YOY" mode to overlay prior year data.

**Q: What is a rep's performance?**
→ Sales Dashboard → click the rep's bar in "Sales by Rep" chart, or use the Rep dropdown filter.

---

## Sq Ft Dashboard

### What It Shows
Corrugator throughput — how many square feet of board are produced per day, per line, and per order hour.

### Navigation
Sidebar → Production → Sq Ft Dashboard (or /erp/sqft)

### KPIs Explained
| KPI | What It Means |
|-----|---------------|
| Sq Ft Entry | Total square footage produced in the period |
| Sq Ft Per Day | Average daily production (total ÷ number of production days) |
| Sq Ft per Order Hour | Efficiency metric — square feet produced per hour of machine time |
| Order Hours | Total hours of production (start to finish of each job) |

### How Calculations Work
- **Sq ft per box** = (entry_width / 192) × (entry_length / 192). Dimensions are stored in 1/16th inches; dividing by 192 (16×12) converts to feet.
- **Total sq ft** = sq ft per box × quantity fed in
- **Order hours** = time from job start to job finish in hours
- Production lines included: 130, 131, 132, 133, 142, 144, 146, 154 (corrugator lines)

### Charts
- **Calendar tab**: Monthly heat map showing daily production. Darker indigo = higher output. Click a day to drill into details.
- **Area tab**: Time-series trend with toggles for Sq Ft per Order Hour or Sq Ft Entry. Granularity: Y/M/W.
- **Bar chart**: Sq Ft per Order Hour by production line, sorted best-to-worst. Click to filter by line.

### Filters
- Time window (YTD, Last Quarter, Last Year, All Time, etc.)
- Production line
- Customer
- Spec number
- Granularity (Y/M/W)

### Common Questions
**Q: Which line is most efficient?**
→ Sq Ft Dashboard → bar chart on the right shows sq ft/hour ranked by line.

**Q: What was production on a specific day?**
→ Sq Ft Dashboard → Calendar tab → click the day cell. KPIs and detail table filter to that day.

**Q: How does this month compare to previous months?**
→ Sq Ft Dashboard → Area tab → Monthly granularity shows the trend over time.

---

## Production Dashboard (OEE)

### What It Shows
Overall Equipment Effectiveness (OEE) — a composite score measuring how well production lines perform. OEE = Quality% × Speed% × Uptime%.

### Navigation
Sidebar → Production → OEE Dashboard (or /erp/production)

### Four Tabs

**Quality Tab**
| KPI | Formula |
|-----|---------|
| Quality % | Produced Sheets / (Produced + Waste) × 100 |
| Produced Sheets | quantity_produced / number_out |
| Waste Sheets | Sum of waste entries (capped at 200K per step) |
| Waste % | Waste / (Produced + Waste) × 100 |

**Speed Tab**
| KPI | Formula |
|-----|---------|
| Speed to Optimum % | (Sheets Per Hour / Optimum Speed) × 100 |
| Sheets Per Hour | Quantity Fed In / Uptime Hours |
| Optimum Speed | Average machine target speed |
| Uptime Hours | Run Hours - Downtime |

**Uptime Tab**
| KPI | Formula |
|-----|---------|
| Uptime % | Uptime Hours / Run Hours × 100 |
| Run Hours | Order Hours - Setup Hours |
| Order Hours | Total time from job start to finish |
| Setup Hours | Machine preparation time (minus downtime during setup) |
| Downtime Open | Unplanned stops (mechanical issues) |
| Downtime Closed | Planned stops (maintenance, breaks) |

**OEE Tab (Composite)**
| KPI | Formula |
|-----|---------|
| OEE % | Quality% × Speed% × Uptime% |
| Plus component breakdowns for Quality, Speed, Uptime |

### Charts
- Area chart trending the selected tab's primary metric over time
- Bar chart showing metric by production line

### Filters
- Time window presets
- Granularity (D/W/M/Y)
- Machine filter
- Shift filter

### Common Questions
**Q: How is OEE calculated?**
→ OEE = Quality% × Speed% × Uptime%. Quality measures scrap/waste, Speed measures how close to optimum the machine runs, Uptime measures productive hours vs total hours. Go to Production Dashboard → OEE tab for the composite view.

**Q: Why is OEE low today?**
→ Production Dashboard → check each tab (Quality, Speed, Uptime) to find which component is dragging OEE down. Look at the area chart for trends and the bar chart for per-line breakdown.

**Q: What shift performs best?**
→ Production Dashboard → use the Shift filter to compare OEE between shifts.

---

## MRP & Inventory Dashboard

### What It Shows
Current inventory levels, demand forecasts, and projected stock balances for all product specs. Helps purchasing and planning teams know what to reorder and when.

### Navigation
Sidebar → Production → MRP & Inventory (or /erp/mrp)

### Three Tabs

**Usage Tab**
- Table showing every spec with: Spec Number, Company, Customer Spec, Min/Max Qty, Min/Max MoS, On-Hand Qty, OH MoS, Last 30 Days Usage, Avg 30-Day Usage (90-day rolling average)
- Color-coded health states: Red = shortage (on-hand ≤ 0), Yellow = below minimum, Green = healthy
- Quick-filter pills: "Shortage" and "Below Min" to focus on problem items

**MRP Tab**
- Projected demand in weekly (or daily) buckets for the next 12 weeks (or 14 days)
- Shows how on-hand inventory is consumed over time
- Bucket totals at the footer

**Inv Value Tab**
- Toggle between Cost basis and Price basis
- Shows projected inventory value per time bucket
- Rate = unit cost or unit price depending on toggle

### Key Metric: Months of Supply (MoS)
MoS = On-Hand Quantity / Average Monthly Usage. If MoS < Min MoS, the item needs reordering.

### Filters
- Company dropdown
- Spec dropdown
- Has Demand/MOs (All / Yes / No)
- Has Min/Max (All / Yes / No)
- Shortage / Below Min quick-filter pills

### Common Questions
**Q: Which items need reordering?**
→ MRP Dashboard → Usage tab → click "Below Min" filter pill. These items have on-hand below their minimum threshold.

**Q: What's in shortage?**
→ MRP Dashboard → Usage tab → click "Shortage" filter pill. Red rows have on-hand ≤ 0.

**Q: How long will current stock last?**
→ MRP Dashboard → Usage tab → check the "OH MoS" (On-Hand Months of Supply) column for any spec.

**Q: What inventory is coming?**
→ MRP Dashboard → MRP tab shows projected demand and scheduled orders in weekly buckets.

---

## Contribution Dashboard

### What It Shows
How much each job/line/customer contributes to overhead and profit after subtracting direct costs (material, labor, freight). The key efficiency metric is Contribution per Order Hour.

### Navigation
Sidebar → Financial → Contribution Dashboard (or /erp/contribution)

### KPIs Explained
| KPI | Formula |
|-----|---------|
| Calculated Value | Total production value from cost estimates |
| Contribution $ | Calculated Value - (Material + Labor + Freight) |
| Contribution % | Contribution / Calculated Value × 100 |
| Contribution / Order Hour | Total Contribution / Total Order Hours |
| Order Hours | Total production time |

### Charts
- **Area chart** with tabs: Contribution per Order Hour, Total Contribution ($)
- **Bar chart**: Contribution by Line — which production lines generate the most contribution per hour

### Table
- Group-by toggles: Date, Job #, Customer, Spec, Line
- Columns: Calculated Value, Contribution $, Order Hours, Contribution %
- Click a chart period to drill down

### Filters
- Time window presets
- Granularity (D/W/M/Y)
- Line, Customer, Spec dropdowns

### Common Questions
**Q: Which line is most profitable?**
→ Contribution Dashboard → bar chart shows contribution per order hour by line.

**Q: How much did a customer contribute?**
→ Contribution Dashboard → filter by customer dropdown, or use the detail table → group by Customer only.

**Q: What's the contribution trend?**
→ Contribution Dashboard → area chart → Total Contribution tab → monthly granularity.

---

## Cost Variance Dashboard

### What It Shows
Compares estimated (pre-production) costs against actual (post-production) costs for material, labor, and freight. Highlights where jobs cost more or less than expected.

### Navigation
Sidebar → Financial → Cost Variance (or /erp/cost-variance)

### Two Views
- **Production view**: Cost variance based on production feedback data
- **Invoice view**: Cost variance based on invoiced amounts (accessible at /erp/invoice-cost-variance)

### KPIs Explained
| KPI | What It Means |
|-----|---------------|
| Est Full Cost | Estimated (Material + Labor + Freight) before production |
| Act Full Cost | Actual (Material + Labor + Freight) after production |
| Full Variance | Estimated - Actual. Green = under budget, Red = over budget |
| Material Variance | Estimated material - Actual material |
| Labor Variance | Estimated labor - Actual labor |
| Freight Variance | Estimated freight - Actual freight |

In the production view, there are also hour-based metrics:
- Est vs Act Order Hours
- Est vs Act Uptime Hours

### Charts
- **Area chart**: Estimated vs Actual cost trend over time. Toggle between Full, Material, Labor, Freight, and Hours.
- **Calendar chart**: Daily heatmap with color coding — green days are under budget, red days are over budget.

### Table
- Group-by toggles: Date, Job #, Customer, Spec, Line
- Shows estimated vs actual for each cost component plus the variance
- Production view includes hours breakdown; invoice view does not

### Filters
- Time window presets
- Granularity (D/W/M/Y)
- Line (production view only)
- Customer, Spec dropdowns

### Common Questions
**Q: Are we spending more than estimated?**
→ Cost Variance Dashboard → check the Full Variance KPI. Red means actual > estimated (over budget).

**Q: Which cost component has the biggest variance?**
→ Cost Variance Dashboard → compare Material, Labor, and Freight variance KPIs. Toggle the area chart to each type.

**Q: Which jobs ran over budget?**
→ Cost Variance Dashboard → detail table → sort by Full Variance ascending (most over-budget first).

**Q: Calendar view of variance?**
→ Cost Variance Dashboard → Calendar tab → red days are over budget, green are under.
`

// SQL reference for admin chat mode.
// Provides categorized query templates so the LLM writes correct SQL on the first try.
// ~3K tokens — appended to system prompt only for ADMIN users.

export const SQL_REFERENCE = `
## SQL Query Reference

You have access to Kiwiplan's SQL Server databases. Two databases:
- **ESP** — transactional/operational (orders, invoices, inventory, cost estimates)
- **KDW** — data warehouse (production feedback, OEE, throughput)

You CANNOT cross-JOIN between ESP and KDW. If a question needs both, run separate queries.

### Global T-SQL Rules
- Always use \`TOP 100\` (or less) unless the user asks for more — never return unbounded result sets.
- Date filtering: \`column >= '2025-01-01' AND column < '2025-02-01'\` (half-open ranges).
- Use \`ISNULL(col, 0)\` for nullable numeric columns.
- Use \`TRY_CAST(col AS FLOAT)\` when casting production quantities.
- Use \`CONVERT(VARCHAR(10), dateCol, 23)\` for YYYY-MM-DD formatting.
- Use \`DATEADD(DAY, -30, GETDATE())\` for relative date math.
- Use \`FORMAT(dateCol, 'yyyy-MM')\` for monthly grouping.
- Production lines (corrugator): 130, 131, 132, 133, 142, 144, 146, 154.
- Excluded machines: 110, 111, 6170 (not production).

---

### 1. Sales & Invoicing (ESP)

**Core JOIN chain:**
\`\`\`
espInvoiceLine il
  INNER JOIN espInvoice inv        ON il.invoiceID = inv.ID
  LEFT JOIN orgCompany cust        ON inv.companyID = cust.ID
  LEFT JOIN orgContact con         ON cust.salesContactID = con.ID
  LEFT JOIN espOrder o             ON il.orderID = o.ID
  LEFT JOIN cstCostEstimate ce     ON o.preCostEstimateID = ce.ID
\`\`\`

**Key columns:**
- \`inv.transactiondate\` — invoice date (use for date filtering)
- \`inv.invoicestatus\` — always filter \`= 'Final'\`
- \`il.totalvalue\` — line revenue ($)
- \`il.areainvoiced / 1000.0\` — MSF (thousand sq ft)
- \`il.quantity\` — units invoiced
- \`con.firstname + ' ' + con.lastname\` — sales rep name
- \`cust.name\` — customer name
- \`(ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity\` — estimated full cost for line

**Example — Top 10 customers by revenue last month:**
\`\`\`sql
SELECT TOP 10
  cust.name AS customer,
  SUM(il.totalvalue) AS totalSales,
  SUM(il.areainvoiced) / 1000.0 AS totalMSF,
  SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) AS totalCost,
  SUM(il.totalvalue) - SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) AS contribution
FROM espInvoiceLine il
INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
LEFT JOIN orgCompany cust ON inv.companyID = cust.ID
LEFT JOIN espOrder o ON il.orderID = o.ID
LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
WHERE inv.transactiondate >= DATEADD(MONTH, -1, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
  AND inv.transactiondate < DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
  AND inv.invoicestatus = 'Final'
GROUP BY cust.name
ORDER BY totalSales DESC
\`\`\`

---

### 2. Production / OEE (KDW)

**Core JOIN chain:**
\`\`\`
dwproductionfeedback pf
  INNER JOIN dwjobseriesstep jss   ON pf.feedback_job_series_step_id = jss.job_series_step_id
  INNER JOIN dwcostcenters cc      ON pf.feedback_costcenter_id = cc.costcenter_id
\`\`\`

**Waste subquery (join separately):**
\`\`\`sql
LEFT JOIN (
  SELECT job_series_step_id,
    SUM(CASE WHEN ISNULL(total_waste, 0) > 200000 THEN 0 ELSE ISNULL(total_waste, 0) END) AS wasteSheets
  FROM dwwaste GROUP BY job_series_step_id
) w ON pf.feedback_job_series_step_id = w.job_series_step_id
\`\`\`

**Downtime subquery:**
\`\`\`sql
LEFT JOIN (
  SELECT downtime_job_series_step_id,
    SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
         THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) AS totalDowntimeHours,
    SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
         THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) AS setupDowntimeHours
  FROM dwdowntimes GROUP BY downtime_job_series_step_id
) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
\`\`\`

**Key columns & calculations:**
- \`pf.feedback_report_date\` — production date
- \`cc.costcenter_number\` — machine/line number
- **Produced sheets:** \`CAST(pf.quantity_produced AS FLOAT) * ISNULL(jss.number_up_exit_1, 1) / NULLIF(jss.number_up_entry_1, 0)\`
- **Quality %:** \`producedSheets / (producedSheets + wasteSheets) * 100\`
- **Uptime hours:** \`(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) - CAST(pf.setup_duration_seconds AS FLOAT)) / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) - ISNULL(dt.totalDowntimeHours, 0)\`
- **Run hours:** \`orderHours - setupHours\`
- **Speed %:** \`(quantity_fed_in / uptimeHours) / optimum_run_speed * 100\`
- **OEE %:** \`Quality% × Speed% × Uptime%\`

**Example — Daily OEE for last 7 days:**
\`\`\`sql
SELECT TOP 100
  CONVERT(VARCHAR(10), pf.feedback_report_date, 23) AS prodDate,
  cc.costcenter_number AS line,
  SUM(CAST(pf.quantity_fed_in AS FLOAT)) AS totalFedIn,
  SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT)) / 3600.0 AS orderHours
FROM dwproductionfeedback pf
INNER JOIN dwjobseriesstep jss ON pf.feedback_job_series_step_id = jss.job_series_step_id
INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
WHERE pf.feedback_report_date >= DATEADD(DAY, -7, GETDATE())
  AND cc.costcenter_number NOT IN (110, 111, 6170)
GROUP BY CONVERT(VARCHAR(10), pf.feedback_report_date, 23), cc.costcenter_number
ORDER BY prodDate DESC, line
\`\`\`

---

### 3. Sq Ft / Throughput (KDW)

Uses the same base tables as OEE, plus production orders.

**Core JOIN chain:**
\`\`\`
dwproductionfeedback pf
  INNER JOIN dwjobseriesstep jss   ON pf.feedback_job_series_step_id = jss.job_series_step_id
  INNER JOIN dwcostcenters cc      ON pf.feedback_costcenter_id = cc.costcenter_id
  LEFT JOIN dwproductionorders po  ON pf.feedback_pcs_order_id = po.pcs_order_id
\`\`\`

**Key calculations:**
- **Sq ft per box:** \`(CAST(pf.entry_width AS FLOAT) / 192.0) * (CAST(pf.entry_length AS FLOAT) / 192.0)\`
  (dimensions stored in 1/16" — divide by 192 = 16×12 to get feet)
- **Total sq ft:** \`sqFtPerBox * CAST(pf.quantity_fed_in AS FLOAT)\`
- **Order hours:** \`DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) / 3600.0\`
- Filter corrugator lines: \`cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)\`
- Customer/spec from: \`po.customer_name\`, \`po.spec_number\`

**Example — Monthly sq ft throughput this year:**
\`\`\`sql
SELECT TOP 100
  FORMAT(pf.feedback_report_date, 'yyyy-MM') AS month,
  SUM((CAST(pf.entry_width AS FLOAT) / 192.0) * (CAST(pf.entry_length AS FLOAT) / 192.0) * CAST(pf.quantity_fed_in AS FLOAT)) AS totalSqFt,
  SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0) AS orderHours,
  COUNT(DISTINCT CAST(pf.feedback_report_date AS DATE)) AS prodDays
FROM dwproductionfeedback pf
INNER JOIN dwjobseriesstep jss ON pf.feedback_job_series_step_id = jss.job_series_step_id
INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
WHERE pf.feedback_report_date >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1)
  AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
GROUP BY FORMAT(pf.feedback_report_date, 'yyyy-MM')
ORDER BY month
\`\`\`

---

### 4. MRP & Inventory (ESP)

**Stock levels:**
\`\`\`
fgsStockLine sl
  INNER JOIN ebxProductDesign pd   ON sl.productdesignID = pd.ID
  INNER JOIN orgCompany co         ON pd.companyID = co.ID
  LEFT JOIN orgContact con         ON co.salesContactID = con.ID
\`\`\`
- Filter: \`sl.storedescription IN ('Jet Container', 'Plant Store')\`
- Key: \`sl.totalphysical\` (on-hand), \`sl.minimumlevel\`, \`sl.maximumlevel\`
- Spec: \`pd.designnumber\`, Customer: \`co.name\`

**Recent usage (despatches):**
\`\`\`
espDocketItem di
  INNER JOIN espDocket d           ON di.docketID = d.ID
  INNER JOIN espOrder o            ON di.orderID = o.ID
\`\`\`
- \`d.despatchdate\` for date filtering
- \`di.quantity\` for units shipped
- \`o.designnumber\` for spec

**Open orders:**
- Table: \`espOrder o\`
- \`o.orderstatus IN ('Part shipped', 'Work In Progress')\`
- Remaining: \`ISNULL(o.orderedquantity, 0) - ISNULL(o.shippedquantity, 0) - ISNULL(o.scrappedquantity, 0) + ISNULL(o.returnedquantity, 0)\`

**Pricing:**
\`\`\`
ebxProductPrice pp
  INNER JOIN ebxProductDesign pd   ON pp.productDesignID = pd.ID
\`\`\`
- \`pp.fullcost\` (unit cost), \`pp.actualprice\` (unit price)
- \`pp.expiryDate IS NULL\` for current price

**Example — Items below minimum stock:**
\`\`\`sql
SELECT TOP 100
  pd.designnumber AS spec,
  co.name AS customer,
  SUM(ISNULL(sl.totalphysical, 0)) AS onHand,
  SUM(ISNULL(sl.minimumlevel, 0)) AS minQty
FROM fgsStockLine sl
INNER JOIN ebxProductDesign pd ON sl.productdesignID = pd.ID
INNER JOIN orgCompany co ON pd.companyID = co.ID
WHERE sl.storedescription IN ('Jet Container', 'Plant Store')
  AND sl.totalphysical IS NOT NULL
GROUP BY pd.designnumber, co.name
HAVING SUM(ISNULL(sl.totalphysical, 0)) < SUM(ISNULL(sl.minimumlevel, 0))
   AND SUM(ISNULL(sl.minimumlevel, 0)) > 0
ORDER BY onHand ASC
\`\`\`

---

### 5. Cost Variance (KDW + ESP)

Two separate queries — cannot cross-JOIN.

**Production data (KDW):** Same base as OEE + \`dwproductionorders po\` for job/customer/spec.
Key output per feedback row: feedbackDate, jobNumber, customerName, specNumber, lineNumber, orderHours, uptimeHours, quantityProduced.

**Cost estimates (ESP):**
\`\`\`
espOrder o
  LEFT JOIN cstCostEstimate pce    ON o.precostestimateID = pce.ID
  LEFT JOIN ocsPostcostedorder pco ON o.ID = pco.orderID
  LEFT JOIN cstCostEstimate postce ON pco.costEstimateID = postce.ID
\`\`\`
- Pre-cost (estimated): \`pce.materialcost / 1000.0\`, \`pce.labourcost / 1000.0\`, \`pce.freightcost / 1000.0\`
- Post-cost (actual): \`postce.materialcost / 1000.0\`, \`postce.labourcost / 1000.0\`, \`postce.freightcost / 1000.0\`
- Costs are per-1000 units — divide by 1000.

**Routing (ESP) for estimated hours:**
\`\`\`
espOrder o
  INNER JOIN espMachineRouteStep rs ON rs.routeID = o.routeID
\`\`\`
- \`rs.routingstdrunrate\` or \`rs.costingstdrunrate\` — sheets/hour
- \`rs.routingstdsetupmins\` or \`rs.costingstdsetupmins\` — setup time

---

### 6. Contribution (KDW + ESP)

**Production value (KDW):** Same base as Sq Ft.
- \`pf.selling_price\` — unit selling price from production
- \`po.ordered_board_cost / po.ordered_quantity\` — fallback unit price
- Calculated value = quantityProduced × unitPrice (split by machine count)

**Cost from ESP:** Same as Cost Variance ESP query.
- Contribution = Calculated Value − Full Cost
- Contribution per Order Hour = total Contribution / total Order Hours
`
