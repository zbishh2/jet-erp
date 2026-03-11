---
name: investigate-cost-variance
description: Investigate cost variance issues by querying ESP and KDW databases. Use when the user wants to understand why a job has high cost variance, investigate post-cost vs pre-cost differences, trace purchase costs, check invoice data, or analyze profitability for a spec or job number.
---

# Cost Variance Investigator

You are investigating cost variance for Jet Container's Kiwiplan ERP system. Query the ESP (Estimating) and KDW (Kiwiplan Data Warehouse) databases to trace cost discrepancies, identify post-costing issues, and produce clear reports.

The user may provide a job number, spec number, or customer name. Use whatever is given to start the investigation.

## Prerequisites

Before querying, ensure the local dev server is running. Try a test query first. If it returns "Module not enabled for organization", seed the local D1 database:

```bash
npx wrangler d1 execute jet-erp-db --local --command "INSERT OR IGNORE INTO organization (id, name, slug, is_active, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000001', 'Dev Org', 'dev-org', 1, '2024-01-01', '2024-01-01');"
npx wrangler d1 execute jet-erp-db --local --command "INSERT OR REPLACE INTO organization_module (id, organization_id, module_id, is_active, activated_at, created_at, updated_at) VALUES ('om-1', '00000000-0000-0000-0000-000000000001', 'mod-erp', 1, '2024-01-01', '2024-01-01', '2024-01-01');"
npx wrangler d1 execute jet-erp-db --local --command "INSERT OR IGNORE INTO user_organization_module (id, user_id, organization_id, module_id, role, created_at, updated_at) VALUES ('uom-1', 'dev', '00000000-0000-0000-0000-000000000001', 'mod-erp', 'ADMIN', '2024-01-01', '2024-01-01');"
```

Then start the dev server (from project root):

```bash
npx wrangler dev --port 3099 --var ENVIRONMENT:development --var ALLOW_DEV_AUTH:true > /dev/null 2>&1 &
sleep 8
```

## How to Query

All queries go through the plant-tv query endpoint via curl:

```bash
curl -s -X POST http://localhost:3099/api/erp/plant-tv/query \
  -H "Content-Type: application/json" \
  -H 'X-Dev-User: {"userId":"dev","email":"dev@test.com","displayName":"Dev","roles":["ADMIN"],"organizationId":"00000000-0000-0000-0000-000000000001"}' \
  -H "X-Organization-Id: 00000000-0000-0000-0000-000000000001" \
  -H "X-Module-Code: erp" \
  -d '{"sql": "YOUR SQL HERE", "database": "kdw"}'
```

- Default database is `kdw`. Pass `"database": "esp"` for the ESP database.
- Only `SELECT` queries are allowed (read-only gateway).

## Query Gotchas (CRITICAL — read before querying)

1. **JOINs can timeout on large KDW tables.** Always include a restrictive WHERE clause (e.g. date range, quantity filter) BEFORE joining. Never filter only on `job_number` or `IS NOT NULL` — these cause full table scans.
2. **ESP `espOrder` uses `jobnumber` (not `orderNumber`).** It's `nvarchar` — use string comparison: `WHERE jobnumber = '11001'`
3. **Prefer sequential single-table queries over complex JOINs.** Get IDs from one table, then query the next. This is far more reliable than multi-table joins that may timeout.
4. **KDW join columns use `_id` suffix** (not `_key`): `feedback_pcs_order_id`, `feedback_costcenter_id`, `feedback_job_series_step_id`
5. **Corrugator machine numbers:** 130, 131, 132, 133, 142, 144, 146, 154
6. **Schema discovery works well:** `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'tableName'`
7. **Subqueries in WHERE can timeout.** Instead, run two separate queries and use the result of the first in the second.

## Investigation Workflow

Run these steps in order, parallelizing independent queries where possible.

### Step 1: Find the Job in ESP

```sql
-- database: esp
SELECT ID, jobnumber, routeID, productdesignID, precostestimateID
FROM espOrder WHERE jobnumber = '{JOB_NUMBER}'
```

### Step 2: Get Pre-Cost and Post-Cost Estimates

```sql
-- database: esp
SELECT costEstimateID FROM ocsPostcostedorder WHERE orderID = {ORDER_ID}
```

```sql
-- database: esp
SELECT ID, materialcost, labourcost, freightcost, fullcost,
       calculationquantity, costingdate, estimatetype
FROM cstCostEstimate WHERE ID IN ({PRE_ID}, {POST_ID})
```

**Key fields:**
- `materialcost`, `labourcost`, `freightcost` are **per-M rates** (per 1000 of `calculationquantity`)
- `estimatetype`: 2 = pre-cost, 3 = post-cost
- `calculationquantity` is typically the order quantity in pieces

### Step 3: Get Cost Estimate Line Items

Run for BOTH pre and post estimates to compare:

```sql
-- database: esp
SELECT ID, costinggroup, costRuleID, totalcost, rulequantity, costrate,
       purchaseCostID, purchaseCostQuantityRangeID, calculationquantity
FROM cstcostEstimateLine
WHERE costEstimateID = {ESTIMATE_ID}
ORDER BY totalcost DESC
```

**`costinggroup` values:** 0 = material, 1 = labour, 2 = freight, 3 = other

**Key cost rules to watch for:**
- **Rule 3** ("Purchased Sheets-Std Cost"): Pre-cost board material using price list
- **Rule 122** ("Consumed Board"): Post-cost actual board consumed
- **Rule 156** ("Purchased Finished Goods"): Post-cost purchased components — **KNOWN BUG: double-counts when both in-house and purchased routes exist for same spec**

### Step 4: Investigate Purchase Costs (if any line has purchaseCostID)

```sql
-- database: esp
SELECT ID, description, uom, supplierCompanyID, productDesignID, routeID,
       activedate, expirydate, mainttime, userID
FROM cstPurchaseCost WHERE ID = {PURCHASE_COST_ID}
```

```sql
-- database: esp
SELECT ID, name FROM orgCompany WHERE ID = {SUPPLIER_COMPANY_ID}
```

```sql
-- database: esp
SELECT qr.ID, qr.minimumquantity, qr.purchasecostperuom, qr.mainttime
FROM cstPurchaseCostQuantityRange qr
WHERE qr.purchasecostdaterangeID IN (
  SELECT ID FROM cstPurchaseCostDateRange WHERE purchaseCostID = {PURCHASE_COST_ID}
)
ORDER BY qr.minimumquantity
```

### Step 5: Check Routes for the Spec

```sql
-- database: esp
SELECT ID, name, productDesignID, routetype, routestatus, isDefault, minimumquantity
FROM ebxRoute WHERE productDesignID = {PRODUCT_DESIGN_ID}
```

- `routetype`: 0 = standard, 1 = history
- `isDefault`: -1 = yes (default route)
- **Red flag:** Multiple active routes (in-house + purchased) can cause the double-counting bug

### Step 6: Check Invoices

```sql
-- database: esp — direct invoice for the order
SELECT il.invoiceID, il.orderID, il.quantity, il.unitprice, il.goodsvalue,
       il.description, il.priceperitem, il.perUnitUOM,
       CONVERT(VARCHAR(10), il.mainttime, 23) as invoice_date
FROM espInvoiceLine il WHERE il.orderID = {ORDER_ID}
```

```sql
-- database: esp — invoice history for the spec (make-to-stock calloffs)
SELECT TOP 10 il.invoiceID, il.orderID, il.quantity, il.unitprice,
       il.goodsvalue, il.description,
       CONVERT(VARCHAR(10), il.mainttime, 23) as invoice_date
FROM espInvoiceLine il
WHERE il.orderID IN (SELECT ID FROM espOrder WHERE productdesignID = {PD_ID})
ORDER BY il.mainttime DESC
```

```sql
-- database: esp — invoice header
SELECT ID, invoicenumber, CONVERT(VARCHAR(10), transactiondate, 23) as inv_date
FROM espInvoice WHERE ID = {INVOICE_ID}
```

### Step 7: Check KDW Production Data (if needed)

```sql
-- database: kdw — use quantity filter to avoid timeout
SELECT TOP 10 pf.quantity_produced, pf.quantity_fed_in, po.job_number,
       po.quantity_ordered, po.customer_name
FROM dwproductionfeedback pf
LEFT JOIN dwproductionorders po ON pf.feedback_pcs_order_id = po.pcs_order_id
WHERE pf.quantity_produced > {EXPECTED_QTY - 1000}
  AND pf.quantity_produced < {EXPECTED_QTY + 1000}
```

### Step 8: Calculate Profitability

Compare invoice price/M vs post-cost full cost/M. If the post-cost seems inflated, check for double-counting (both rule 122 AND rule 156 on same estimate). Calculate the correct margin using only the applicable cost components.

## Known Issues

### Double-Counting Bug (Cost Rule 156)
When a spec has BOTH an in-house corrugator route AND an active Purchased Finished Goods cost, post-costing includes BOTH the consumed board cost AND the purchase cost. Pre-costing correctly excludes the purchase cost for in-house routes, but post-costing's rule 156 (`costruletype=0`) evaluates ALL purchase costs for the product design regardless of route.

**How to identify:** Post-cost has BOTH cost rule 122 (Consumed Board) AND cost rule 156 (Purchased FG) lines. Compare against calloff orders for the same spec — they should have one OR the other, not both.

### Order Qty vs Actual Production
Cost rule 156 uses `[#Costing Order Qty]` (order quantity) for its calculation, not actual sheets ran. For jobs where actual production differs from order quantity, this further distorts the per-M rate.

## Report Format

Present findings as:

1. **Job Summary** — job #, customer, spec, line, date, quantities
2. **Cost Comparison** — pre vs post cost headers in a table (material, labour, freight per-M)
3. **Line Item Analysis** — what cost rules contributed to the variance, with a table showing the biggest contributors
4. **Root Cause** — why the variance exists (double-counting, rate change, missing pre-cost component, etc.)
5. **Invoice & Profitability** — what was invoiced, actual margin vs reported margin
6. **Recommendations** — what needs to be fixed

## Reference

- Previous investigation: `docs/investigations/job-11001-cost-variance-investigation.md`
- Dashboard code: `apps/api/src/routes/cost-variance-dashboard.ts`
- ESP/KDW schema reference: see memory files at `~/.claude/projects/*/memory/esp-kdw-schemas.md`
