# Cost Variance Investigation: Job 11001 (Spec 77442)

**Date:** March 10, 2026
**Investigated by:** Zack (with agent assistance)
**Customer:** Victoria's
**Spec:** 77442 — DC 7 x 3 x 2
**Line:** 131
**Job Date:** May 7, 2025

---

## Summary

The -$23,464 material variance on job 11001 is caused by a **Kiwiplan post-costing configuration issue** that **double-counts product cost** when both an in-house corrugator route and a purchased finished goods option exist for the same spec. The post-cost includes both the corrugator board cost ($87.30/M) AND the Kelly Box purchase cost ($130/M), even though the job was run in-house. The job is actually profitable at ~42% margin.

---

## Job 11001 Dashboard Data

| Field | Value |
|---|---|
| Date | 5/7/25 |
| Job # | 11001 |
| Customer | Victoria's |
| Spec | 77442 |
| Line | 131 |
| Qty (pieces) | 174,564 |
| # Out | 12 |
| Sheets Fed | 14,547 |
| Est Mat | $15,108 |
| Act Mat | $38,611 |
| Mat Var | -$23,502 |
| Est Lab | $219 |
| Act Lab | $181 |
| Lab Var | $39 |
| Est Full | $15,328 |
| Act Full | $38,791 |
| **Variance** | **-$23,464** |

---

## Root Cause: Post-Cost Double Counting

### The Two Sourcing Options for Spec 77442

This spec has two active sourcing routes in Kiwiplan:

| Route | ID | Description | Status | Cost Basis |
|---|---|---|---|---|
| Route 1 | 3101 | In-house corrugator (default) | Active | Board material ~$86/M |
| Kelly Box | 20821 | Purchase from KELLY BOX & PACKAGING CORP. | Active | $130/M purchased FG |

There was also an older farm-out route to RABB CORRUGATED ($160/M) which is now Obsolete.

### What Happened During Post-Costing

Job 11001 was produced **in-house on line 131** using Route 1 (ID 3101). The post-costing process on 5/8/25 correctly calculated the consumed board cost. **However**, it ALSO picked up the Kelly Box purchased finished goods cost because:

1. **Cost rule 156** ("Purchased Finished Goods") has `costruletype=0`, meaning it evaluates against ALL purchase costs for the product design — not just the route used for the order
2. The Kelly Box purchase cost (ID 1528) became active on **5/1/2025** (created by `JET\rocco`), just 7 days before post-costing ran
3. The condition in cost rule 156 checks `[PurchaseCost.includeincosting]` and `[$PurchaseCostPerUOM] > 0`, but does NOT check whether the order was actually sourced via the purchase route

### Proof: Calloff Orders Show Correct Behavior

The calloff orders for the same spec (77442) prove the two cost structures should be **mutually exclusive**:

| Order | Post Material/M | Board Cost | Purchase Cost | Interpretation |
|---|---|---|---|---|
| C9553 (in-house) | $85.18/M | $81.50/M (rule 122) | None | Shipped from in-house stock |
| C9492 (purchased) | $133.62/M | None | $130/M (rule 156) | Shipped from Kelly Box stock |
| C9459 (purchased) | $133.62/M | None | $130/M (rule 156) | Shipped from Kelly Box stock |
| **Job 11001** | **$221.18/M** | **$87.30/M (rule 122)** | **$130/M (rule 156)** | **DOUBLE COUNTED** |

---

## Pre-Cost vs Post-Cost Comparison

### ESP Cost Estimate Headers

| | Pre-Cost (ID 64989) | Post-Cost (ID 68938) |
|---|---|---|
| Material | $86.55/M | $221.18/M |
| Labour | $1.26/M | $1.03/M |
| Freight | $0.57/M | $0.58/M |
| Full Cost | $88.73/M | $223.02/M |
| Calc Qty | 180,000 | 174,564 |
| Costing Date | 2025-06-19 | 2025-05-08 |
| Estimate Type | 2 (pre-cost) | 3 (post-cost) |

### Post-Cost Line Item Breakdown (Material)

| Line ID | Cost Rule | Description | Rate | Per-M Cost |
|---|---|---|---|---|
| 760131 | 122 | Consumed Board | $0.97/sheet × 15,703 sheets | $87.30/M |
| **760132** | **156** | **Purchased Finished Goods (KELLY BOX)** | **$130/M** | **$130.00/M** |
| 760133 | 21 | Ink | $3.80 | $0.76/M |
| 760134 | 21 | Ink | $3.80 | $0.76/M |
| 760137 | 20 | Other | $9.25 | $2.23/M |
| Other | — | Misc small items | — | $0.13/M |
| | | **Total Material** | | **$221.18/M** |

### Why the Pre-Cost Correctly Excludes the Purchase Cost

- The pre-cost estimate uses **Route 1 (ID 3101)** — the in-house default route
- Pre-costing evaluates cost rules specific to the route; cost rule 3 ("Purchased Sheets-Std Cost") calculates board cost at $82.23/M
- The Kelly Box purchase cost is attached to a separate route (ID 20821) and is correctly excluded during pre-costing

---

## Purchase Cost Details

### Purchase Cost Record (ID 1528)

| Field | Value |
|---|---|
| Description | Purchased Finished Goods |
| Supplier | KELLY BOX & PACKAGING CORP. (company ID 1142) |
| UOM | Per 1000 pieces |
| Route | "Kelly Box" (route ID 20821) |
| Active Date | 2025-05-01 |
| Expiry Date | None |
| Include in Costing | Yes |
| Created/Modified By | `JET\mhall` (record), `JET\rocco` (qty range) |

### Quantity Range (ID 3164)

| Field | Value |
|---|---|
| Min Quantity | 172,800 |
| Cost Per UOM | $130.00 per 1000 pcs |
| Created | 2025-05-01 by `JET\rocco` |

---

## Invoice Analysis

### Job 11001 Invoice

| Field | Value |
|---|---|
| Invoice # | 11647 |
| Invoice Date | 2025-05-08 |
| Quantity | 180,600 pcs |
| Unit Price | $165/M |
| Goods Value | **$29,799** |
| Description | DC 7 x 3 x 2 |

### Selling Price History (Spec 77442)

All recent invoices are consistently priced at **$165/M**:

| Invoice Date | Qty | Price/M | Total |
|---|---|---|---|
| 2026-03-09 | 185,688 | $165 | $30,639 |
| 2026-03-04 | 179,091 | $165 | $29,550 |
| 2026-03-04 | 175,824 | $165 | $29,011 |
| 2026-02-25 | 173,052 | $165 | $28,554 |
| 2026-02-23 | 177,078 | $165 | $29,218 |
| 2025-12-17 | 168,696 | $165 | $27,835 |
| 2025-05-08 | 180,600 | $165 | $29,799 |

---

## Profitability Analysis

| Scenario | Material/M | Full Cost/M | Price/M | Margin/M | Margin % |
|---|---|---|---|---|---|
| **Correct (in-house)** | ~$88 | ~$95 | $165 | **$70** | **42%** |
| If purchased (Kelly Box) | ~$134 | ~$141 | $165 | **$24** | **15%** |
| **What post-cost shows** | $221 | $223 | $165 | **-$58** | **LOSS** |

The job is actually profitable at ~42% margin when correctly costed as in-house production. The post-cost makes it appear as a ~$10,000 loss.

---

## Recommendations

1. **Kiwiplan Configuration Fix**: Cost rule 156 ("Purchased Finished Goods") should be modified to only apply when the order was actually sourced via a purchased route — not when it was produced in-house. The condition expression should check the order's route against the purchase cost's route.

2. **Immediate Impact Assessment**: Identify all production jobs for specs that have both an in-house route AND active purchased finished goods costs. These jobs likely all have inflated post-costs.

3. **Review Purchase Cost Activation**: The Kelly Box purchase cost was activated on 5/1/25. Any production jobs post-costed after that date for affected specs would show this double-counting.

---

## Technical Reference

### Key ESP Tables & IDs

| Entity | ID | Notes |
|---|---|---|
| espOrder | 19122 | Job 11001 |
| Pre-Cost Estimate | 64989 | estimatetype=2 |
| Post-Cost Estimate | 68938 | estimatetype=3 |
| Purchase Cost (Kelly) | 1528 | $130/M, active 5/1/25 |
| Purchase Cost (Rabb) | 652 | $160/M, route Obsolete |
| Qty Range | 3164 | Min 172,800, $130/M |
| Product Design | 2421 | Spec 77442 |
| Route 1 (in-house) | 3101 | Default, Active |
| Route Kelly Box | 20821 | Active |
| Route Rabb | 5570 | Obsolete |
| History Route | 22563 | "History 11001(77442)" |
| Supplier (Kelly) | 1142 | KELLY BOX & PACKAGING CORP. |
| Supplier (Rabb) | 2912 | RABB CORRUGATED |
| Invoice | 11752 | Invoice #11647, $29,799 |

### Cost Rules Involved

| Rule ID | Description | Type | Used In |
|---|---|---|---|
| 3 | Purchased Sheets-Std Cost | 1 (route) | Pre-cost only |
| 122 | Consumed Board | 2 (post-cost) | Post-cost only |
| 156 | Purchased Finished Goods | 0 (general) | Post-cost — **causes double-count** |
