import { Request, Response, NextFunction } from 'express'
import { config } from '../config.js'

/**
 * Query Allowlist
 *
 * ONLY these predefined queries can be executed.
 * No dynamic SQL, no string concatenation.
 *
 * SECURITY RULES:
 * 1. All queries MUST be SELECT only (no INSERT/UPDATE/DELETE)
 * 2. All tenant-scoped queries MUST include company filter
 * 3. Unscoped queries (system config) MUST be explicitly marked
 * 4. Parameters are ALWAYS bound, never concatenated
 */

// Type for allowed query definitions
interface QueryDefinition {
  sql: string
  requiredParams: string[]
  description: string
  /**
   * If true, this query is NOT filtered by company.
   * Use ONLY for system-wide configuration data.
   * These queries are logged with extra scrutiny.
   */
  unscopedSystemConfig?: boolean
}

// Queries that are unscoped (system config) - tracked separately for visibility
// These return shared master data that is not tenant-scoped
export const UNSCOPED_QUERIES = ['getCostRules', 'listBoardGrades', 'listInks', 'listStyles', 'listPlantRates', 'listCustomers', 'getCustomer', 'listCustomerAddresses', 'getFreightZone', 'getDespatchMode', 'exploreSchema', 'exploreColumns', 'getCostVarianceSummary', 'getCostVarianceStats', 'getCostVarianceTrend', 'getSalesMonthlySummary', 'getSalesByRep', 'getSalesByCustomer', 'getSalesRepList'] as const

// All allowed queries - add new queries here
// Column names verified against actual Kiwiplan schema on 2026-01-25
export const ALLOWED_QUERIES: Record<string, QueryDefinition> = {
  // ============================================================================
  // QUOTE QUERIES (company-scoped)
  // ============================================================================

  listQuotes: {
    sql: `
      SELECT
        q.ID as quoteId,
        q.quoteNumber,
        c.name as customerName,
        q.mainttime as quoteDate,
        q.quotestatus as status,
        q.validuntil as validUntil,
        q.companyID
      FROM ebxQuote q
      LEFT JOIN orgCompany c ON q.companyID = c.ID
      WHERE (@companyId IS NULL OR q.companyID = @companyId)
      ORDER BY q.mainttime DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `,
    requiredParams: ['limit', 'offset'],
    description: 'List quotes with pagination',
  },

  getQuote: {
    sql: `
      SELECT
        q.ID as quoteId,
        q.quoteNumber,
        q.companyID,
        c.name as customerName,
        q.mainttime as quoteDate,
        q.quotestatus as status,
        q.validuntil as validUntil,
        q.comments,
        q.headercomments,
        q.footercomments
      FROM ebxQuote q
      LEFT JOIN orgCompany c ON q.companyID = c.ID
      WHERE q.ID = @quoteId
        AND (@companyId IS NULL OR q.companyID = @companyId)
    `,
    requiredParams: ['quoteId'],
    description: 'Get single quote by ID',
  },

  getQuoteProducts: {
    sql: `
      SELECT
        pd.ID as productDesignId,
        pd.designnumber as designNumber,
        pd.description,
        pd.internalLength,
        pd.internalWidth,
        pd.internalDepth,
        pd.finishedlength as finishedLength,
        pd.finishedwidth as finishedWidth,
        pd.finishedarea as finishedArea,
        pd.productdesignstatus as status,
        pd.companyID
      FROM ebxProductDesign pd
      WHERE pd.quoteID = @quoteId
        AND (@companyId IS NULL OR pd.companyID = @companyId)
      ORDER BY pd.ID DESC
    `,
    requiredParams: ['quoteId', 'companyId'],
    description: 'Get product designs for a quote',
  },

  // ============================================================================
  // CUSTOMER QUERIES - UNSCOPED MASTER DATA
  // ============================================================================
  // orgCompany is a shared master table containing ALL companies in the ERP:
  // - Your company (the one running Kiwiplan)
  // - Your customers (companies you sell to)
  // - Your suppliers (companies you buy from)
  // There is no parent-child relationship, so customers cannot be filtered by companyId.
  // This is standard ERP architecture - the customer master is shared.

  /**
   * listCustomers - UNSCOPED MASTER DATA
   *
   * Returns all companies flagged as customers from the shared orgCompany table.
   * This is intentionally unscoped as customers are master data shared across
   * all divisions/companies in the ERP instance.
   */
  listCustomers: {
    sql: `
      SELECT
        c.ID as customerId,
        c.companynumber as customerNumber,
        c.name,
        c.isCustomer,
        c.isSupplier
      FROM orgCompany c
      WHERE c.isCustomer <> 0
        AND (@search IS NULL OR c.name LIKE '%' + @search + '%' OR c.companynumber LIKE '%' + @search + '%')
      ORDER BY c.name
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `,
    requiredParams: ['limit', 'offset'],
    description: 'List customers with search (shared master data)',
    unscopedSystemConfig: true,
  },

  /**
   * getCustomer - UNSCOPED MASTER DATA
   *
   * Returns a single customer from the shared orgCompany table.
   */
  getCustomer: {
    sql: `
      SELECT
        c.ID as customerId,
        c.companynumber as customerNumber,
        c.name,
        c.comments,
        c.quickcode,
        c.companystatus as status
      FROM orgCompany c
      WHERE c.ID = @customerId
    `,
    requiredParams: ['customerId'],
    description: 'Get single customer by ID (shared master data)',
    unscopedSystemConfig: true,
  },

  // ============================================================================
  // COSTING QUERIES
  // ============================================================================

  /**
   * getCostRules - UNSCOPED SYSTEM CONFIGURATION
   *
   * WARNING: This query returns ALL cost rules across the system.
   * Cost rules are shared configuration data, not tenant-specific.
   *
   * JUSTIFICATION:
   * - Cost rules define pricing formulas used by all companies
   * - They are read-only reference data
   * - They contain no customer-specific or sensitive information
   * - They are required for the pricing calculator feature
   *
   * RISK: Low (read-only config data, no PII, no financial data)
   */
  getCostRules: {
    sql: `
      SELECT
        cr.ID as ruleId,
        cr.description as ruleName,
        ca.name as accountName,
        cr.costformula as costFormula,
        cr.priceformula as priceFormula,
        cr.conditionexpression as conditionExpression,
        cr.variableamount as variableAmount,
        cr.fixedamount as fixedAmount,
        cr.activedate,
        cr.expirydate
      FROM cstCostRule cr
      LEFT JOIN cstCostAccount ca ON cr.costAccountID = ca.ID
      WHERE cr.activedate <= GETDATE()
        AND (cr.expirydate IS NULL OR cr.expirydate > GETDATE())
      ORDER BY ca.name, cr.description
    `,
    requiredParams: [],
    description: 'Get active cost rules (system-wide config, read-only)',
    unscopedSystemConfig: true,
  },

  getProductCostEstimate: {
    sql: `
      SELECT
        ce.ID as estimateId,
        ce.productDesignID,
        ce.fullcost as fullCost,
        ce.materialcost as materialCost,
        ce.labourcost as labourCost,
        ce.freightcost as freightCost,
        ce.otherdirectcost as otherDirectCost,
        ce.otherindirectcost as otherIndirectCost,
        ce.costingdate as costingDate,
        ce.calculationquantity as quantity
      FROM cstCostEstimate ce
      INNER JOIN ebxProductDesign pd ON ce.productDesignID = pd.ID
      WHERE ce.productDesignID = @productDesignId
        AND (@companyId IS NULL OR pd.companyID = @companyId)
    `,
    requiredParams: ['productDesignId'],
    description: 'Get cost estimate for a product design',
  },

  // ============================================================================
  // REFERENCE DATA QUERIES (unscoped - system configuration)
  // ============================================================================

  /**
   * listBoardGrades - UNSCOPED SYSTEM CONFIGURATION
   *
   * Returns board specifications from ebxStandardBoard.
   * These are shared reference data used for product design.
   */
  listBoardGrades: {
    sql: `
      SELECT
        b.ID as boardId,
        b.name as code,
        b.description,
        b.density,
        b.thickness,
        b.costperarea as costPerArea,
        b.isobsolete as isObsolete,
        bb.name as basicBoardName
      FROM ebxStandardBoard b
      LEFT JOIN ebxStandardBasicBoard bb ON b.basicboardID = bb.ID
      WHERE b.isobsolete = 0
      ORDER BY b.name
    `,
    requiredParams: [],
    description: 'List active board grades (system-wide reference data)',
    unscopedSystemConfig: true,
  },

  /**
   * listInks - UNSCOPED SYSTEM CONFIGURATION
   *
   * Returns ink/color specifications from ebxStandardColourCoating.
   * These are shared reference data used for product design.
   */
  listInks: {
    sql: `
      SELECT
        c.ID as inkId,
        c.name as code,
        c.description,
        c.iscoating as isCoating,
        c.colourCoatingGroup as colorGroup,
        c.mAPcode as mapCode,
        c.isobsolete as isObsolete,
        ct.name as coatingTypeName
      FROM ebxStandardColourCoating c
      LEFT JOIN ebxStandardColourCoatingType ct ON c.standardColourCoatingTypeID = ct.ID
      WHERE c.isobsolete = 0
      ORDER BY c.colourCoatingGroup, c.name
    `,
    requiredParams: [],
    description: 'List active inks/colors (system-wide reference data)',
    unscopedSystemConfig: true,
  },

  /**
   * listStyles - UNSCOPED SYSTEM CONFIGURATION
   *
   * Returns box/case style definitions (RSC, HSC, etc.) from ebxStyle.
   * These are shared reference data used for product design.
   */
  listStyles: {
    sql: `
      SELECT
        s.ID as styleId,
        s.stylecode as code,
        s.description,
        s.stylestatus as status,
        s.analysisGroup,
        s.imagename as imageName,
        ud.description as unitDescription
      FROM ebxStyle s
      LEFT JOIN ebxStandardUnitDescription ud ON s.standardUnitDescriptionID = ud.ID
      WHERE s.stylestatus IS NULL OR s.stylestatus <> 'Obsolete'
      ORDER BY s.stylecode
    `,
    requiredParams: [],
    description: 'List active box styles (system-wide reference data)',
    unscopedSystemConfig: true,
  },

  /**
   * listPlantRates - UNSCOPED SYSTEM CONFIGURATION
   *
   * Returns plant/machine rates for labor costing.
   */
  listPlantRates: {
    sql: `
      SELECT
        pr.ID as rateId,
        pr.machineno as machineNumber,
        pr.costrate as costRate,
        pr.pricerate as priceRate,
        pr.activedate as activeDate,
        pr.expirydate as expiryDate,
        cr.description as costRuleName,
        p.name as plantName
      FROM cstPlantRate pr
      LEFT JOIN cstCostRule cr ON pr.costRuleID = cr.ID
      LEFT JOIN orgPlant p ON pr.plantID = p.ID
      WHERE pr.activedate <= GETDATE()
        AND (pr.expirydate IS NULL OR pr.expirydate > GETDATE())
      ORDER BY p.name, pr.machineno
    `,
    requiredParams: [],
    description: 'List active plant/machine rates (system-wide reference data)',
    unscopedSystemConfig: true,
  },

  // ============================================================================
  // ADDRESS & FREIGHT QUERIES - UNSCOPED MASTER DATA
  // ============================================================================

  /**
   * listCustomerAddresses - UNSCOPED MASTER DATA
   *
   * Returns all addresses for a customer from orgAddress.
   * Addresses are tied to orgCompany which is shared master data.
   */
  listCustomerAddresses: {
    sql: `
      SELECT a.ID as addressId, a.street, a.city, a.state, a.zipcode, a.country,
             a.latitude, a.longitude, a.isshiptodefault,
             a.deliveryRegionID, a.standardDespatchModeID
      FROM orgAddress a
      WHERE a.companyID = @customerId
      UNION
      SELECT a.ID as addressId, a.street, a.city, a.state, a.zipcode, a.country,
             a.latitude, a.longitude, a.isshiptodefault,
             a.deliveryRegionID, a.standardDespatchModeID
      FROM orgAddress a
      INNER JOIN orgCompany c ON (c.billingAddressID = a.ID OR c.mailingAddressID = a.ID)
      WHERE c.ID = @customerId
      ORDER BY isshiptodefault DESC, city
    `,
    requiredParams: ['customerId'],
    description: 'List addresses for a customer (shared master data)',
    unscopedSystemConfig: true,
  },

  /**
   * getFreightZone - UNSCOPED MASTER DATA
   *
   * Returns freight zone info (mileage, rates) for a delivery region.
   */
  getFreightZone: {
    sql: `
      SELECT fz.ID as freightZoneId, fz.journeydistance, fz.journeyduration,
             fz.freightper, fz.fullloadfreightcharge, fz.partloadfreightcharge,
             fz.fromAddressID
      FROM orgFreightZone fz
      WHERE fz.deliveryRegionID = @deliveryRegionId
    `,
    requiredParams: ['deliveryRegionId'],
    description: 'Get freight zone for a delivery region (shared master data)',
    unscopedSystemConfig: true,
  },

  /**
   * getDespatchMode - UNSCOPED MASTER DATA
   *
   * Returns shipping method details.
   */
  getDespatchMode: {
    sql: `
      SELECT dm.ID as despatchModeId, dm.name, dm.iscustomerpickup
      FROM orgStandardDespatchMode dm
      WHERE dm.ID = @despatchModeId
    `,
    requiredParams: ['despatchModeId'],
    description: 'Get despatch mode details (shared master data)',
    unscopedSystemConfig: true,
  },

  // ============================================================================
  // ROUTING QUERIES (company-scoped)
  // ============================================================================

  /**
   * getRouting - COMPANY-SCOPED
   *
   * Returns machine routing steps for a product design.
   * Company-scoped via ebxRoute → ebxProductDesign.
   */
  getRouting: {
    sql: `
      SELECT rs.machineno, rs.machinename, rs.machinegroup, rs.sequencenumber,
             rs.routingstdrunrate, rs.costingstdrunrate,
             rs.routingstdsetupmins, rs.costingstdsetupmins,
             rs.inkcount, rs.routingcrew, rs.costingcrew
      FROM espMachineRouteStep rs
      INNER JOIN ebxRoute r ON rs.routeID = r.ID
      INNER JOIN ebxProductDesign pd ON r.productDesignID = pd.ID
      WHERE r.productDesignID = @productDesignId
        AND (@companyId IS NULL OR pd.companyID = @companyId)
      ORDER BY rs.sequencenumber
    `,
    requiredParams: ['productDesignId'],
    description: 'Get machine routing for a product design',
  },

  /**
   * getRoutingByStyle - COMPANY-SCOPED
   *
   * Returns machine routing steps from the most recently maintained product design
   * for a given box style. Used when creating new quotes where no product design
   * exists yet — the style's most recent routing serves as a template.
   *
   * Selection logic: picks the product design with the latest mainttime
   * (null mainttime sorts last via COALESCE), breaking ties by ID DESC.
   * Company-scoped via ebxProductDesign.companyID.
   */
  getRoutingByStyle: {
    sql: `
      SELECT rs.machineno, rs.machinename, rs.machinegroup, rs.sequencenumber,
             rs.routingstdrunrate, rs.costingstdrunrate,
             rs.routingstdsetupmins, rs.costingstdsetupmins,
             rs.inkcount, rs.routingcrew, rs.costingcrew
      FROM espMachineRouteStep rs
      INNER JOIN ebxRoute r ON rs.routeID = r.ID
      WHERE r.productDesignID = (
        SELECT TOP 1 r2.productDesignID
        FROM ebxRoute r2
        INNER JOIN ebxProductDesign pd ON r2.productDesignID = pd.ID
        WHERE pd.styleID = @styleId
          AND (@companyId IS NULL OR pd.companyID = @companyId)
        ORDER BY COALESCE(pd.mainttime, '1900-01-01') DESC, pd.ID DESC
      )
      ORDER BY rs.sequencenumber
    `,
    requiredParams: ['styleId'],
    description: 'Get machine routing from most recent product design for a box style',
  },

  // ============================================================================
  // SCHEMA EXPLORATION (for development/discovery)
  // ============================================================================

  /**
   * exploreSchema - Find tables by name pattern
   * Uses sys.tables which typically has better permission access
   */
  exploreSchema: {
    sql: `
      SELECT
        t.name as tableName,
        s.name as schemaName
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE t.name LIKE '%' + @pattern + '%'
      ORDER BY t.name
    `,
    requiredParams: ['pattern'],
    description: 'Find tables matching a pattern (schema exploration)',
    unscopedSystemConfig: true,
  },

  /**
   * exploreColumns - Get columns for a specific table
   */
  exploreColumns: {
    sql: `
      SELECT
        COLUMN_NAME as columnName,
        DATA_TYPE as dataType,
        IS_NULLABLE as isNullable,
        CHARACTER_MAXIMUM_LENGTH as maxLength
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = @tableName
      ORDER BY ORDINAL_POSITION
    `,
    requiredParams: ['tableName'],
    description: 'Get columns for a table (schema exploration)',
    unscopedSystemConfig: true,
  },

  // ============================================================================
  // COST VARIANCE ANALYSIS (unscoped - internal analysis)
  // ============================================================================
  //
  // These queries compare pre-cost estimates vs post-costed actuals.
  // All costs in cstCostEstimate are PER 1000 (per M).
  // Order-level cost = (costPerM / 1000) * calculationquantity
  //
  // ASSUMPTIONS (verify via /schema/columns?tableName=<table>):
  //   - espOrder has: ordernumber, companyID, preCostEstimateID
  //   - ocsPostCostedOrder has: orderID (FK→espOrder), costEstimateID (FK→cstCostEstimate)
  // If column names differ, update the SQL below.

  /**
   * getCostVarianceSummary - UNSCOPED INTERNAL ANALYSIS
   *
   * Per-order comparison of pre-cost estimate vs post-costed actual.
   * Sorted by largest absolute full cost variance (worst first).
   * Includes rate vs quantity variance decomposition.
   *
   * Rate variance: how much variance is due to cost-per-M changing
   * Quantity variance: how much variance is due to running different qty
   */
  getCostVarianceSummary: {
    sql: `
      SELECT
        o.ID as orderId,
        o.ordernumber as orderNumber,
        c.name as customerName,
        pre.calculationquantity as preQuantity,
        post.calculationquantity as postQuantity,
        pre.ID as preCostEstimateId,
        post.ID as postCostEstimateId,
        pre.fullcost as preFullCostPerM,
        post.fullcost as postFullCostPerM,
        ROUND((pre.fullcost / 1000.0) * pre.calculationquantity, 2) as preOrderCost,
        ROUND((post.fullcost / 1000.0) * post.calculationquantity, 2) as postOrderCost,
        ROUND((post.fullcost / 1000.0) * post.calculationquantity
              - (pre.fullcost / 1000.0) * pre.calculationquantity, 2) as fullCostVariance,
        CASE WHEN (pre.fullcost / 1000.0) * pre.calculationquantity = 0 THEN NULL
             ELSE ROUND(((post.fullcost / 1000.0) * post.calculationquantity
                        - (pre.fullcost / 1000.0) * pre.calculationquantity)
                  / ((pre.fullcost / 1000.0) * pre.calculationquantity) * 100, 1)
        END as fullCostVariancePct,
        ROUND((post.materialcost / 1000.0) * post.calculationquantity
              - (pre.materialcost / 1000.0) * pre.calculationquantity, 2) as materialVariance,
        ROUND((post.labourcost / 1000.0) * post.calculationquantity
              - (pre.labourcost / 1000.0) * pre.calculationquantity, 2) as labourVariance,
        ROUND((post.freightcost / 1000.0) * post.calculationquantity
              - (pre.freightcost / 1000.0) * pre.calculationquantity, 2) as freightVariance,
        ROUND((post.otherdirectcost / 1000.0) * post.calculationquantity
              - (pre.otherdirectcost / 1000.0) * pre.calculationquantity, 2) as otherDirectVariance,
        ROUND((post.otherindirectcost / 1000.0) * post.calculationquantity
              - (pre.otherindirectcost / 1000.0) * pre.calculationquantity, 2) as otherIndirectVariance,
        ROUND(((post.fullcost - pre.fullcost) / 1000.0) * pre.calculationquantity, 2) as rateVariance,
        ROUND(((post.calculationquantity - pre.calculationquantity) / 1000.0) * pre.fullcost, 2) as quantityVariance,
        pre.costingdate as preCostingDate,
        post.costingdate as postCostingDate
      FROM espOrder o
      INNER JOIN cstCostEstimate pre ON o.preCostEstimateID = pre.ID
      INNER JOIN ocsPostCostedOrder pco ON pco.orderID = o.ID
      INNER JOIN cstCostEstimate post ON pco.costEstimateID = post.ID
      LEFT JOIN orgCompany c ON o.companyID = c.ID
      WHERE (@orderNumber IS NULL OR o.ordernumber = @orderNumber)
      ORDER BY ABS((post.fullcost / 1000.0) * post.calculationquantity
                  - (pre.fullcost / 1000.0) * pre.calculationquantity) DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `,
    requiredParams: ['limit', 'offset'],
    description: 'Pre vs post cost variance per order with rate/quantity decomposition',
    unscopedSystemConfig: true,
  },

  /**
   * getCostVarianceStats - UNSCOPED INTERNAL ANALYSIS
   *
   * Aggregate statistics across all orders that have both pre and post costs.
   * Shows systemic bias (are we consistently over/under estimating?)
   * and which cost categories contribute most to total variance.
   */
  getCostVarianceStats: {
    sql: `
      SELECT
        COUNT(*) as orderCount,
        SUM(CASE WHEN (post.fullcost / 1000.0) * post.calculationquantity
                    > (pre.fullcost / 1000.0) * pre.calculationquantity THEN 1 ELSE 0 END) as actualExceededEstimateCount,
        SUM(CASE WHEN (post.fullcost / 1000.0) * post.calculationquantity
                    < (pre.fullcost / 1000.0) * pre.calculationquantity THEN 1 ELSE 0 END) as actualBelowEstimateCount,
        ROUND(AVG((pre.fullcost / 1000.0) * pre.calculationquantity), 2) as avgPreOrderCost,
        ROUND(AVG((post.fullcost / 1000.0) * post.calculationquantity), 2) as avgPostOrderCost,
        ROUND(AVG((post.fullcost / 1000.0) * post.calculationquantity
                  - (pre.fullcost / 1000.0) * pre.calculationquantity), 2) as avgFullCostVariance,
        ROUND(SUM(ABS((post.fullcost / 1000.0) * post.calculationquantity
                     - (pre.fullcost / 1000.0) * pre.calculationquantity)), 2) as totalAbsVariance,
        ROUND(MAX((post.fullcost / 1000.0) * post.calculationquantity
                  - (pre.fullcost / 1000.0) * pre.calculationquantity), 2) as maxOverrun,
        ROUND(MIN((post.fullcost / 1000.0) * post.calculationquantity
                  - (pre.fullcost / 1000.0) * pre.calculationquantity), 2) as maxUnderrun,
        ROUND(AVG((post.materialcost / 1000.0) * post.calculationquantity
                  - (pre.materialcost / 1000.0) * pre.calculationquantity), 2) as avgMaterialVariance,
        ROUND(AVG((post.labourcost / 1000.0) * post.calculationquantity
                  - (pre.labourcost / 1000.0) * pre.calculationquantity), 2) as avgLabourVariance,
        ROUND(AVG((post.freightcost / 1000.0) * post.calculationquantity
                  - (pre.freightcost / 1000.0) * pre.calculationquantity), 2) as avgFreightVariance,
        ROUND(AVG((post.otherdirectcost / 1000.0) * post.calculationquantity
                  - (pre.otherdirectcost / 1000.0) * pre.calculationquantity), 2) as avgOtherDirectVariance,
        ROUND(AVG((post.otherindirectcost / 1000.0) * post.calculationquantity
                  - (pre.otherindirectcost / 1000.0) * pre.calculationquantity), 2) as avgOtherIndirectVariance,
        ROUND(AVG(((post.fullcost - pre.fullcost) / 1000.0) * pre.calculationquantity), 2) as avgRateVariance,
        ROUND(AVG(((post.calculationquantity - pre.calculationquantity) / 1000.0) * pre.fullcost), 2) as avgQuantityVariance,
        ROUND(AVG(CASE WHEN (pre.fullcost / 1000.0) * pre.calculationquantity <> 0
             THEN ((post.fullcost / 1000.0) * post.calculationquantity
                   - (pre.fullcost / 1000.0) * pre.calculationquantity)
                  / ((pre.fullcost / 1000.0) * pre.calculationquantity) * 100
        END), 1) as avgVariancePct
      FROM espOrder o
      INNER JOIN cstCostEstimate pre ON o.preCostEstimateID = pre.ID
      INNER JOIN ocsPostCostedOrder pco ON pco.orderID = o.ID
      INNER JOIN cstCostEstimate post ON pco.costEstimateID = post.ID
    `,
    requiredParams: [],
    description: 'Aggregate cost variance statistics with rate/quantity decomposition',
    unscopedSystemConfig: true,
  },

  /**
   * getCostVarianceTrend - UNSCOPED INTERNAL ANALYSIS
   *
   * Monthly trend of cost variance. Uses pre-cost estimate date as the
   * time axis. Shows whether estimating accuracy is improving or degrading.
   */
  getCostVarianceTrend: {
    sql: `
      SELECT
        FORMAT(pre.costingdate, 'yyyy-MM') as month,
        COUNT(*) as orderCount,
        ROUND(AVG((post.fullcost / 1000.0) * post.calculationquantity
                  - (pre.fullcost / 1000.0) * pre.calculationquantity), 2) as avgFullCostVariance,
        ROUND(AVG((post.materialcost / 1000.0) * post.calculationquantity
                  - (pre.materialcost / 1000.0) * pre.calculationquantity), 2) as avgMaterialVariance,
        ROUND(AVG((post.labourcost / 1000.0) * post.calculationquantity
                  - (pre.labourcost / 1000.0) * pre.calculationquantity), 2) as avgLabourVariance,
        ROUND(AVG(CASE WHEN (pre.fullcost / 1000.0) * pre.calculationquantity <> 0
             THEN ((post.fullcost / 1000.0) * post.calculationquantity
                   - (pre.fullcost / 1000.0) * pre.calculationquantity)
                  / ((pre.fullcost / 1000.0) * pre.calculationquantity) * 100
        END), 1) as avgVariancePct,
        ROUND(SUM(ABS((post.fullcost / 1000.0) * post.calculationquantity
                     - (pre.fullcost / 1000.0) * pre.calculationquantity)), 2) as totalAbsVariance,
        ROUND(AVG(((post.fullcost - pre.fullcost) / 1000.0) * pre.calculationquantity), 2) as avgRateVariance,
        ROUND(AVG(((post.calculationquantity - pre.calculationquantity) / 1000.0) * pre.fullcost), 2) as avgQuantityVariance
      FROM espOrder o
      INNER JOIN cstCostEstimate pre ON o.preCostEstimateID = pre.ID
      INNER JOIN ocsPostCostedOrder pco ON pco.orderID = o.ID
      INNER JOIN cstCostEstimate post ON pco.costEstimateID = post.ID
      WHERE pre.costingdate IS NOT NULL
      GROUP BY FORMAT(pre.costingdate, 'yyyy-MM')
      ORDER BY month DESC
    `,
    requiredParams: [],
    description: 'Monthly trend of cost variance for estimating accuracy tracking',
    unscopedSystemConfig: true,
  },
  // ============================================================================
  // SALES DASHBOARD QUERIES (unscoped - single-tenant, all data is Jet Container's)
  // ============================================================================

  /**
   * getSalesMonthlySummary - UNSCOPED INTERNAL ANALYSIS
   *
   * Monthly aggregation of invoice sales data for a date range.
   * Includes total sales, MSF, estimated cost (from pre-cost estimates),
   * and invoice count.
   */
  getSalesMonthlySummary: {
    sql: `
      SELECT
        FORMAT(inv.transactiondate, 'yyyy-MM') as month,
        SUM(il.goodsvalue) as totalSales,
        SUM(il.areainvoiced) as totalMSF,
        SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost,
        COUNT(DISTINCT inv.ID) as invoiceCount
      FROM espInvoiceLine il
      INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
      LEFT JOIN espOrder o ON il.orderID = o.ID
      LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
      WHERE inv.transactiondate >= @startDate
        AND inv.transactiondate < @endDate
      GROUP BY FORMAT(inv.transactiondate, 'yyyy-MM')
      ORDER BY month
    `,
    requiredParams: ['startDate', 'endDate'],
    description: 'Monthly sales summary with cost estimates for date range',
    unscopedSystemConfig: true,
  },

  /**
   * getSalesByRep - UNSCOPED INTERNAL ANALYSIS
   *
   * Sales aggregated by sales rep for a date range.
   * Rep is determined via orgCompany.repContactID → orgContact.
   */
  getSalesByRep: {
    sql: `
      SELECT
        con.firstname + ' ' + con.lastname as repName,
        SUM(il.goodsvalue) as totalSales,
        SUM(il.areainvoiced) as totalMSF,
        SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost
      FROM espInvoiceLine il
      INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
      LEFT JOIN orgCompany cust ON inv.companyID = cust.ID
      LEFT JOIN orgContact con ON cust.repContactID = con.ID
      LEFT JOIN espOrder o ON il.orderID = o.ID
      LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
      WHERE inv.transactiondate >= @startDate
        AND inv.transactiondate < @endDate
      GROUP BY con.firstname + ' ' + con.lastname
      ORDER BY totalSales DESC
    `,
    requiredParams: ['startDate', 'endDate'],
    description: 'Sales aggregated by sales rep for date range',
    unscopedSystemConfig: true,
  },

  /**
   * getSalesByCustomer - UNSCOPED INTERNAL ANALYSIS
   *
   * Sales aggregated by customer for a date range.
   * Includes rep name, invoice count, and cost data.
   */
  getSalesByCustomer: {
    sql: `
      SELECT
        cust.name as customerName,
        con.firstname + ' ' + con.lastname as repName,
        SUM(il.goodsvalue) as totalSales,
        SUM(il.areainvoiced) as totalMSF,
        SUM((ISNULL(ce.fullcost, 0) / 1000.0) * il.quantity) as totalCost,
        COUNT(DISTINCT inv.ID) as invoiceCount
      FROM espInvoiceLine il
      INNER JOIN espInvoice inv ON il.invoiceID = inv.ID
      INNER JOIN orgCompany cust ON inv.companyID = cust.ID
      LEFT JOIN orgContact con ON cust.repContactID = con.ID
      LEFT JOIN espOrder o ON il.orderID = o.ID
      LEFT JOIN cstCostEstimate ce ON o.preCostEstimateID = ce.ID
      WHERE inv.transactiondate >= @startDate
        AND inv.transactiondate < @endDate
      GROUP BY cust.name, con.firstname + ' ' + con.lastname
      ORDER BY totalSales DESC
    `,
    requiredParams: ['startDate', 'endDate'],
    description: 'Sales aggregated by customer for date range',
    unscopedSystemConfig: true,
  },

  /**
   * getSalesRepList - UNSCOPED MASTER DATA
   *
   * Distinct sales reps for filter dropdowns.
   * Only includes reps that are assigned to at least one customer.
   */
  getSalesRepList: {
    sql: `
      SELECT DISTINCT
        con.ID as contactId,
        con.firstname + ' ' + con.lastname as repName
      FROM orgContact con
      INNER JOIN orgCompany cust ON cust.repContactID = con.ID
      WHERE cust.isCustomer <> 0
      ORDER BY repName
    `,
    requiredParams: [],
    description: 'List distinct sales reps for filter dropdowns',
    unscopedSystemConfig: true,
  },
}

/**
 * Check if a query is unscoped (system config)
 */
export function isUnscopedQuery(name: string): boolean {
  const query = ALLOWED_QUERIES[name]
  return query?.unscopedSystemConfig === true
}

/**
 * Get a query by name
 */
export function getQuery(name: string): QueryDefinition | null {
  return ALLOWED_QUERIES[name] || null
}

/**
 * Apply company filter for dev mode safety
 *
 * In dev mode, ALL queries are filtered to the test company.
 * This prevents accidental access to production customer data.
 *
 * In prod mode, companyId must be explicitly provided by the caller.
 * Passing null/undefined will cause validation to fail for tenant-scoped queries.
 */
export function applyCompanyFilter(params: Record<string, unknown>): Record<string, unknown> {
  if (config.devMode && config.testCompanyId) {
    return {
      ...params,
      companyId: config.testCompanyId,
    }
  }

  // In prod mode, preserve the companyId as-is (will be validated later)
  // Don't silently convert undefined to null - let validation catch it
  return {
    ...params,
    companyId: params.companyId,
  }
}

/**
 * Validate that companyId is provided in production mode
 *
 * In production, tenant-scoped queries MUST have companyId.
 * This prevents accidental "fetch all companies" queries.
 *
 * @param params - Query parameters
 * @param queryName - Name of the query (to check if it's unscoped)
 * @returns Validation result with error message if invalid
 */
export function validateCompanyScope(
  params: Record<string, unknown>,
  queryName: string
): { valid: boolean; error?: string } {
  // Dev mode always has companyId set by applyCompanyFilter
  if (config.devMode) {
    return { valid: true }
  }

  // Unscoped queries (system config) don't need companyId
  if (isUnscopedQuery(queryName)) {
    return { valid: true }
  }

  // In prod, companyId is required for tenant-scoped queries
  if (params.companyId === undefined || params.companyId === null) {
    return {
      valid: false,
      error: 'companyId is required in production mode',
    }
  }

  return { valid: true }
}

/**
 * Validate that all required params are present
 */
export function validateParams(
  query: QueryDefinition,
  params: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const missing = query.requiredParams.filter(p => params[p] === undefined)
  return {
    valid: missing.length === 0,
    missing,
  }
}

/**
 * Middleware to validate query requests
 */
export function validateQueryMiddleware(req: Request, res: Response, next: NextFunction): void {
  const queryName = req.params.queryName || req.body?.queryName

  if (!queryName) {
    res.status(400).json({ error: 'Query name is required' })
    return
  }

  const query = getQuery(queryName)
  if (!query) {
    console.warn(`[VALIDATE] Rejected unknown query: ${queryName}`)
    res.status(403).json({ error: `Query not allowed: ${queryName}` })
    return
  }

  // Log warning for unscoped queries
  if (isUnscopedQuery(queryName)) {
    console.warn(`[VALIDATE] Executing UNSCOPED query: ${queryName} (system config data)`)
  }

  // Attach query to request for later use
  (req as any).allowedQuery = query

  next()
}
