import { Hono } from 'hono'
import type { Env } from '../types/bindings'
import {
  createKiwiplanClient,
  isKiwiplanConfigured,
  KiwiplanError,
} from '../services/kiwiplan-client'

import { kvCache, CacheTTL } from '../services/kv-cache'

export const productionDashboardRoutes = new Hono<{ Bindings: Env }>()

// Helper to get configured client
function getClient(env: Env) {
  if (!isKiwiplanConfigured(env)) {
    return null
  }
  return createKiwiplanClient({
    baseUrl: env.KIWIPLAN_GATEWAY_URL!,
    serviceToken: env.KIWIPLAN_SERVICE_TOKEN!,
  })
}

// ── SQL queries — all against KDW (kdw_master) database ──────────────
//
// Schema verified from Power BI PBIP semantic model (OEE Dashboard v2).
//
// Key tables & joins:
//   dwproductionfeedback pf
//     → dwjobseriesstep jss  ON pf.feedback_job_series_step_id = jss.job_series_step_id
//     → dwcostcenters cc     ON pf.feedback_costcenter_id = cc.costcenter_id
//     → dwwaste w             ON pf.feedback_job_series_step_id = w.job_series_step_id
//
// Quality formula (matches PBI):
//   Number Out        = jss.number_up_entry_1 / jss.number_up_exit_1
//   Sheets Produced   = pf.quantity_produced / Number Out
//                     = pf.quantity_produced * jss.number_up_exit_1 / jss.number_up_entry_1
//   Wasted Quantity   = SUM(w.wasted_quantity) WHERE w.waste_property != 0, capped at 200k per step
//   Quality %         = Sheets Produced / (Sheets Produced + Wasted Quantity)
//
// Filters (matching PBI Power Query):
//   - Exclude machines 110, 111, 6170
//   - Exclude rows where actual_run_duration_minutes = 0

// Common FROM/JOIN/WHERE clause shared across quality queries
function qualityFromClause(hasMachine: boolean, hasShift: boolean) {
  const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
  const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''

  return `
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN (
      SELECT
        job_series_step_id,
        SUM(CASE WHEN waste_property != 0 THEN wasted_quantity ELSE 0 END) as total_waste
      FROM dwwaste
      GROUP BY job_series_step_id
    ) wps ON pf.feedback_job_series_step_id = wps.job_series_step_id
    WHERE pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate
      AND pf.actual_run_duration_minutes != 0
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      ${machineWhere}
      ${shiftWhere}
  `
}

// Speed FROM clause — includes downtime subquery for Uptime Hours calc
// Uptime Hours = (Order Duration - setup_duration_seconds) / 3600 - (Total Downtime - Setup Downtime)
// where Order Duration = DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish)
function speedFromClause(hasMachine: boolean, hasShift: boolean) {
  const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
  const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''

  return `
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN (
      SELECT
        downtime_job_series_step_id,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
      FROM dwdowntimes
      GROUP BY downtime_job_series_step_id
    ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
    WHERE pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate
      AND pf.actual_run_duration_minutes != 0
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      ${machineWhere}
      ${shiftWhere}
      ${ABOVE_OPTIMUM_FILTER}
  `
}

// PBI "Final Speed Rating" filter — exclude rows where per-row speed exceeds optimum
// Exception: Machine 131 in June 2025 is always kept
const ABOVE_OPTIMUM_FILTER = `
  AND (
    CASE
      WHEN cc.costcenter_number = 131
        AND MONTH(pf.feedback_report_date) = 6
        AND YEAR(pf.feedback_report_date) = 2025
      THEN 1
      WHEN cc.costcenter_number = 154
        AND (CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0)) > 15000
      THEN 0
      WHEN cc.costcenter_number != 154
        AND (CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0)) > CAST(cc.optimum_run_speed AS FLOAT)
      THEN 0
      ELSE 1
    END = 1
  )
`

// Uptime Hours per row = (OrderDuration - setup_duration_seconds) / 3600 + setupDowntime - totalDowntime
const UPTIME_HOURS_EXPR = `
  (DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) - CAST(pf.setup_duration_seconds AS FLOAT))
  / 3600.0
  + ISNULL(dt.setupDowntimeHours, 0)
  - ISNULL(dt.totalDowntimeHours, 0)
`

// Uptime FROM clause — extended downtime subquery with open/closed breakdown
function uptimeFromClause(hasMachine: boolean, hasShift: boolean) {
  const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
  const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''

  return `
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN (
      SELECT
        downtime_job_series_step_id,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 0
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeOpenHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 1
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeClosedHours
      FROM dwdowntimes
      GROUP BY downtime_job_series_step_id
    ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
    WHERE pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate
      AND pf.actual_run_duration_minutes != 0
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      ${machineWhere}
      ${shiftWhere}
      ${ABOVE_OPTIMUM_FILTER}
  `
}

// Uptime SELECT columns — returns raw hours, client computes runHours/uptimeHours/uptimePct
const UPTIME_SELECT_COLS = `
  SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT)) / 3600.0 as orderHours,
  SUM(CAST(pf.setup_duration_seconds AS FLOAT)) / 3600.0 - SUM(ISNULL(dt.setupDowntimeHours, 0)) as setupHours,
  SUM(ISNULL(dt.downtimeOpenHours, 0)) as downtimeOpen,
  SUM(ISNULL(dt.downtimeClosedHours, 0)) as downtimeClosed
`

// OEE FROM clause — joins waste + extended downtime + speed filter computed column
function oeeFromClause(hasMachine: boolean, hasShift: boolean) {
  const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
  const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''

  return `
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss
      ON pf.feedback_job_series_step_id = jss.job_series_step_id
    INNER JOIN dwcostcenters cc
      ON pf.feedback_costcenter_id = cc.costcenter_id
    LEFT JOIN (
      SELECT
        job_series_step_id,
        SUM(CASE WHEN waste_property != 0 THEN wasted_quantity ELSE 0 END) as total_waste
      FROM dwwaste
      GROUP BY job_series_step_id
    ) wps ON pf.feedback_job_series_step_id = wps.job_series_step_id
    LEFT JOIN (
      SELECT
        downtime_job_series_step_id,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 0
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeOpenHours,
        SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 1
             THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeClosedHours
      FROM dwdowntimes
      GROUP BY downtime_job_series_step_id
    ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
    CROSS APPLY (VALUES (
      CASE
        WHEN cc.costcenter_number = 131
          AND MONTH(pf.feedback_report_date) = 6
          AND YEAR(pf.feedback_report_date) = 2025
        THEN 1
        WHEN cc.costcenter_number = 154
          AND (CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0)) > 15000
        THEN 0
        WHEN cc.costcenter_number != 154
          AND (CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0)) > CAST(cc.optimum_run_speed AS FLOAT)
        THEN 0
        ELSE 1
      END
    )) speedFilter(include)
    WHERE pf.feedback_report_date >= @startDate
      AND pf.feedback_report_date < @endDate
      AND pf.actual_run_duration_minutes != 0
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      ${machineWhere}
      ${shiftWhere}
  `
}

// OEE SELECT — quality + speed (filtered) + uptime aggregates in one query
const OEE_SELECT_COLS = `
  SUM(
    CAST(pf.quantity_produced AS FLOAT)
    * ISNULL(jss.number_up_exit_1, 1)
    / NULLIF(jss.number_up_entry_1, 0)
  ) as producedSheets,
  SUM(
    CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0
         ELSE ISNULL(wps.total_waste, 0)
    END
  ) as wasteSheets,
  SUM(CASE WHEN speedFilter.include = 1 THEN CAST(pf.quantity_fed_in AS FLOAT) ELSE 0 END) as speedFedIn,
  SUM(CASE WHEN speedFilter.include = 1 THEN ${UPTIME_HOURS_EXPR} ELSE 0 END) as speedUptimeHours,
  AVG(CASE WHEN speedFilter.include = 1
    THEN CAST(cc.optimum_run_speed AS FLOAT)
  END) as avgOptimumSpeed,
  SUM(CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT)) / 3600.0 as orderHours,
  SUM(CAST(pf.setup_duration_seconds AS FLOAT)) / 3600.0 - SUM(ISNULL(dt.setupDowntimeHours, 0)) as setupHours,
  SUM(ISNULL(dt.downtimeOpenHours, 0)) as downtimeOpen,
  SUM(ISNULL(dt.downtimeClosedHours, 0)) as downtimeClosed
`

function getOeeSummarySQL(granularity: string, hasMachine: boolean, hasShift: boolean) {
  let periodExpr: string
  switch (granularity) {
    case 'daily':
      periodExpr = `CONVERT(VARCHAR(10), CAST(pf.feedback_report_date AS DATE), 23)`
      break
    case 'weekly':
      periodExpr = `CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23)`
      break
    case 'yearly':
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy')`
      break
    default: // monthly
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy-MM')`
  }

  return `
    SELECT
      ${periodExpr} as period,
      ${OEE_SELECT_COLS}
    ${oeeFromClause(hasMachine, hasShift)}
    GROUP BY ${periodExpr}
    ORDER BY ${periodExpr}
  `
}

function getUptimeSummarySQL(granularity: string, hasMachine: boolean, hasShift: boolean) {
  let periodExpr: string
  switch (granularity) {
    case 'daily':
      periodExpr = `CONVERT(VARCHAR(10), CAST(pf.feedback_report_date AS DATE), 23)`
      break
    case 'weekly':
      periodExpr = `CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23)`
      break
    case 'yearly':
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy')`
      break
    default: // monthly
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy-MM')`
  }

  return `
    SELECT
      ${periodExpr} as period,
      ${UPTIME_SELECT_COLS}
    ${uptimeFromClause(hasMachine, hasShift)}
    GROUP BY ${periodExpr}
    ORDER BY ${periodExpr}
  `
}

function getSpeedSummarySQL(granularity: string, hasMachine: boolean, hasShift: boolean) {
  let periodExpr: string
  switch (granularity) {
    case 'daily':
      periodExpr = `CONVERT(VARCHAR(10), CAST(pf.feedback_report_date AS DATE), 23)`
      break
    case 'weekly':
      periodExpr = `CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23)`
      break
    case 'yearly':
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy')`
      break
    default: // monthly
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy-MM')`
  }

  return `
    SELECT
      ${periodExpr} as period,
      SUM(CAST(pf.quantity_fed_in AS FLOAT)) as totalFedIn,
      SUM(${UPTIME_HOURS_EXPR}) as uptimeHours,
      AVG(CAST(cc.optimum_run_speed AS FLOAT)) as avgOptimumSpeed
    ${speedFromClause(hasMachine, hasShift)}
    GROUP BY ${periodExpr}
    ORDER BY ${periodExpr}
  `
}

function getQualitySummarySQL(granularity: string, hasMachine: boolean, hasShift: boolean) {
  let periodExpr: string
  switch (granularity) {
    case 'daily':
      periodExpr = `CONVERT(VARCHAR(10), CAST(pf.feedback_report_date AS DATE), 23)`
      break
    case 'weekly':
      periodExpr = `CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23)`
      break
    case 'yearly':
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy')`
      break
    default: // monthly
      periodExpr = `FORMAT(pf.feedback_report_date, 'yyyy-MM')`
  }

  return `
    SELECT
      ${periodExpr} as period,
      SUM(
        CAST(pf.quantity_produced AS FLOAT)
        * ISNULL(jss.number_up_exit_1, 1)
        / NULLIF(jss.number_up_entry_1, 0)
      ) as producedSheets,
      SUM(pf.quantity_produced) as producedQty,
      SUM(
        CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0
             ELSE ISNULL(wps.total_waste, 0)
        END
      ) as wasteSheets,
      SUM(pf.quantity_fed_in) as fedQty
    ${qualityFromClause(hasMachine, hasShift)}
    GROUP BY ${periodExpr}
    ORDER BY ${periodExpr}
  `
}

const PRODUCTION_SQL = {
  qualityByMachine: (hasShift: boolean) => `
    SELECT
      CAST(cc.costcenter_number AS VARCHAR) + ' ' + cc.costcenter_name as machineName,
      cc.costcenter_number as machineNumber,
      SUM(
        CAST(pf.quantity_produced AS FLOAT)
        * ISNULL(jss.number_up_exit_1, 1)
        / NULLIF(jss.number_up_entry_1, 0)
      ) as producedSheets,
      SUM(pf.quantity_produced) as producedQty,
      SUM(
        CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0
             ELSE ISNULL(wps.total_waste, 0)
        END
      ) as wasteSheets,
      SUM(pf.quantity_fed_in) as fedQty
    ${qualityFromClause(false, hasShift)}
    GROUP BY cc.costcenter_number, cc.costcenter_name
    ORDER BY producedSheets DESC
  `,

  qualityByShift: (hasMachine: boolean) => `
    SELECT
      ISNULL(jss.crew_id, 'Unknown') as shiftName,
      SUM(
        CAST(pf.quantity_produced AS FLOAT)
        * ISNULL(jss.number_up_exit_1, 1)
        / NULLIF(jss.number_up_entry_1, 0)
      ) as producedSheets,
      SUM(pf.quantity_produced) as producedQty,
      SUM(
        CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0
             ELSE ISNULL(wps.total_waste, 0)
        END
      ) as wasteSheets,
      SUM(pf.quantity_fed_in) as fedQty
    ${qualityFromClause(hasMachine, false)}
    GROUP BY jss.crew_id
    ORDER BY producedSheets DESC
  `,

  machines: `
    SELECT DISTINCT
      cc.costcenter_number as machineNumber,
      CAST(cc.costcenter_number AS VARCHAR) + ' ' + cc.costcenter_name as machineName
    FROM dwproductionfeedback pf
    INNER JOIN dwcostcenters cc ON pf.feedback_costcenter_id = cc.costcenter_id
    WHERE pf.actual_run_duration_minutes != 0
      AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
    ORDER BY cc.costcenter_number
  `,

  wasteByCategory: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        ISNULL(w.waste_code, 'Unknown') as wasteCode,
        SUM(w.wasted_quantity) as wasteSheets
      FROM dwwaste w
      INNER JOIN dwproductionfeedback pf
        ON w.job_series_step_id = pf.feedback_job_series_step_id
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        AND w.waste_property != 0
        ${machineWhere}
        ${shiftWhere}
      GROUP BY w.waste_code
      ORDER BY wasteSheets DESC
    `
  },

  shifts: `
    SELECT DISTINCT
      jss.crew_id as shiftName
    FROM dwproductionfeedback pf
    INNER JOIN dwjobseriesstep jss ON pf.feedback_job_series_step_id = jss.job_series_step_id
    WHERE pf.actual_run_duration_minutes != 0
      AND jss.crew_id IS NOT NULL
    ORDER BY jss.crew_id
  `,

  speedByMachine: (hasShift: boolean) => {
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        CAST(cc.costcenter_number AS VARCHAR) + ' ' + cc.costcenter_name as machineName,
        cc.costcenter_number as machineNumber,
        SUM(CAST(pf.quantity_fed_in AS FLOAT)) as totalFedIn,
        SUM(${UPTIME_HOURS_EXPR}) as uptimeHours,
        AVG(CAST(cc.optimum_run_speed AS FLOAT)) as optimumSpeed
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${shiftWhere}
        ${ABOVE_OPTIMUM_FILTER}
      GROUP BY cc.costcenter_number, cc.costcenter_name
      ORDER BY totalFedIn DESC
    `
  },

  speedByShift: (hasMachine: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    return `
      SELECT
        ISNULL(jss.crew_id, 'Unknown') as shiftName,
        SUM(CAST(pf.quantity_fed_in AS FLOAT)) as totalFedIn,
        SUM(${UPTIME_HOURS_EXPR}) as uptimeHours
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${ABOVE_OPTIMUM_FILTER}
      GROUP BY jss.crew_id
      ORDER BY totalFedIn DESC
    `
  },

  uptimeByMachine: (hasShift: boolean) => {
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        CAST(cc.costcenter_number AS VARCHAR) + ' ' + cc.costcenter_name as machineName,
        cc.costcenter_number as machineNumber,
        ${UPTIME_SELECT_COLS}
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 0
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeOpenHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 1
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeClosedHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${shiftWhere}
        ${ABOVE_OPTIMUM_FILTER}
      GROUP BY cc.costcenter_number, cc.costcenter_name
      ORDER BY orderHours DESC
    `
  },

  uptimeByShift: (hasMachine: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    return `
      SELECT
        ISNULL(jss.crew_id, 'Unknown') as shiftName,
        ${UPTIME_SELECT_COLS}
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 0
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeOpenHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_closed_flag = 1
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as downtimeClosedHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${ABOVE_OPTIMUM_FILTER}
      GROUP BY jss.crew_id
      ORDER BY orderHours DESC
    `
  },

  oeeByMachine: (hasShift: boolean) => `
    SELECT
      CAST(cc.costcenter_number AS VARCHAR) + ' ' + cc.costcenter_name as machineName,
      cc.costcenter_number as machineNumber,
      ${OEE_SELECT_COLS}
    ${oeeFromClause(false, hasShift)}
    GROUP BY cc.costcenter_number, cc.costcenter_name
    ORDER BY cc.costcenter_number
  `,

  oeeByShift: (hasMachine: boolean) => `
    SELECT
      ISNULL(jss.crew_id, 'Unknown') as shiftName,
      ${OEE_SELECT_COLS}
    ${oeeFromClause(hasMachine, false)}
    GROUP BY jss.crew_id
    ORDER BY jss.crew_id
  `,

  speedDetail: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23) as weekStartDate,
        cc.costcenter_number as lineNumber,
        CONVERT(VARCHAR(10), pf.feedback_report_date, 23) as feedbackDate,
        jss.feedback_job_number as jobNum,
        po.customer_name as customerName,
        po.spec_number as specNumber,
        CASE WHEN computed.uptimeHours > 0 AND computed.optimumSpeed > 0
          THEN (CAST(pf.quantity_fed_in AS FLOAT) / computed.uptimeHours) / computed.optimumSpeed * 100
          ELSE 0 END as speedToOptimumPct,
        CASE WHEN computed.orderHours > 0 AND computed.optimumSpeed > 0
          THEN (CAST(pf.quantity_fed_in AS FLOAT) / computed.orderHours) / computed.optimumSpeed * 100
          ELSE 0 END as speedToOptimumOrderPct,
        CASE WHEN computed.uptimeHours > 0
          THEN CAST(pf.quantity_fed_in AS FLOAT) / computed.uptimeHours
          ELSE 0 END as speedSheetsPerHour,
        CASE WHEN computed.orderHours > 0
          THEN CAST(pf.quantity_fed_in AS FLOAT) / computed.orderHours
          ELSE 0 END as speedSheetsPerOrderHour,
        computed.uptimeHours,
        CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0) as actualSpeed,
        computed.optimumSpeed as optimumRunSpeed,
        computed.orderHours,
        CASE WHEN computed.runHours > 0
          THEN computed.uptimeHours / computed.runHours * 100
          ELSE 0 END as uptimePct
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      OUTER APPLY (
        SELECT TOP 1 po2.customer_name, po2.spec_number
        FROM dwproductionorders po2
        WHERE po2.job_number = jss.feedback_job_number
      ) po
      CROSS APPLY (
        SELECT
          CAST(CASE WHEN cc.costcenter_number = 154 THEN 15000 ELSE cc.optimum_run_speed END AS FLOAT) as optimumSpeed,
          CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0 as orderHours,
          (CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) - CAST(pf.setup_duration_seconds AS FLOAT))
            / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) as runHours,
          (CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) - CAST(pf.setup_duration_seconds AS FLOAT))
            / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) - ISNULL(dt.totalDowntimeHours, 0) as uptimeHours
      ) computed
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${shiftWhere}
        ${ABOVE_OPTIMUM_FILTER}
      ORDER BY pf.feedback_report_date DESC
    `
  },

  speedExceptions: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        pf.feedback_report_date as feedDate,
        CAST(cc.costcenter_number AS VARCHAR) + ' ' + cc.costcenter_name as machineName,
        cc.costcenter_number as machineNumber,
        ISNULL(jss.crew_id, 'Unknown') as shiftName,
        pf.quantity_fed_in as fedIn,
        CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0 as runHours,
        CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0) as actualSpeed,
        CAST(CASE WHEN cc.costcenter_number = 154 THEN 15000 ELSE cc.optimum_run_speed END AS FLOAT) as optimumSpeed
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${shiftWhere}
        AND NOT (
          cc.costcenter_number = 131
          AND MONTH(pf.feedback_report_date) = 6
          AND YEAR(pf.feedback_report_date) = 2025
        )
        AND (
          (cc.costcenter_number = 154
            AND (CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0)) > 15000)
          OR
          (cc.costcenter_number != 154
            AND (CAST(pf.quantity_fed_in AS FLOAT) / NULLIF(CAST(pf.actual_run_duration_seconds AS FLOAT) / 3600.0, 0)) > CAST(cc.optimum_run_speed AS FLOAT))
        )
      ORDER BY pf.feedback_report_date DESC
    `
  },

  uptimeDetail: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23) as weekStartDate,
        CONVERT(VARCHAR(10), pf.feedback_report_date, 23) as feedbackDate,
        jss.feedback_job_number as jobNum,
        cc.costcenter_number as lineNumber,
        po.customer_name as customerName,
        po.spec_number as specNumber,
        CAST(pf.setup_duration_seconds AS FLOAT) / 3600.0 - ISNULL(dt.setupDowntimeHours, 0) as setupHours,
        computed.runHours,
        ISNULL(dt.totalDowntimeHours, 0) as downtimeHours,
        computed.orderHours,
        computed.uptimeHours,
        CASE WHEN computed.orderHours > 0
          THEN (CAST(pf.setup_duration_seconds AS FLOAT) / 3600.0 - ISNULL(dt.setupDowntimeHours, 0)) / computed.orderHours * 100
          ELSE 0 END as setupPct,
        CASE WHEN computed.runHours > 0
          THEN computed.uptimeHours / computed.runHours * 100
          ELSE 0 END as uptimePct,
        CASE WHEN computed.orderHours > 0
          THEN ISNULL(dt.totalDowntimeHours, 0) / computed.orderHours * 100
          ELSE 0 END as downtimePct
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      OUTER APPLY (
        SELECT TOP 1 po2.customer_name, po2.spec_number
        FROM dwproductionorders po2
        WHERE po2.job_number = jss.feedback_job_number
      ) po
      CROSS APPLY (
        SELECT
          CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0 as orderHours,
          (CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) - CAST(pf.setup_duration_seconds AS FLOAT))
            / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) as runHours,
          (CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) - CAST(pf.setup_duration_seconds AS FLOAT))
            / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) - ISNULL(dt.totalDowntimeHours, 0) as uptimeHours
      ) computed
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${shiftWhere}
        ${ABOVE_OPTIMUM_FILTER}
      ORDER BY pf.feedback_report_date DESC
    `
  },

  downtimeByReason: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND d.downtime_costcenter_id = (SELECT TOP 1 cc2.costcenter_id FROM dwcostcenters cc2 WHERE cc2.costcenter_number = @machine)` : ''
    const shiftWhere = hasShift ? `AND EXISTS (SELECT 1 FROM dwjobseriesstep jss2 WHERE jss2.job_series_step_id = d.downtime_job_series_step_id AND jss2.crew_id = @shift)` : ''
    return `
      SELECT
        ISNULL(d.downtime_class_name, 'Unknown') as className,
        SUM(CAST(d.downtime_duration_seconds AS FLOAT) / 3600.0) as downtimeHours
      FROM dwdowntimes d
      INNER JOIN dwcostcenters cc
        ON d.downtime_costcenter_id = cc.costcenter_id
      WHERE d.downtime_report_date >= @startDate
        AND d.downtime_report_date < @endDate
        AND d.check_downtime_crosses_shift = 'OK'
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${shiftWhere}
      GROUP BY d.downtime_class_name
      ORDER BY downtimeHours DESC
    `
  },

  oeeDetail: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        CONVERT(VARCHAR(10), pf.feedback_report_date, 23) as feedbackDate,
        cc.costcenter_number as lineNumber,
        jss.feedback_job_number as jobNum,
        po.customer_name as customerName,
        po.spec_number as specNumber,
        pcts.uptimePct,
        pcts.speedToOptimumPct,
        pcts.qualityPct,
        CASE WHEN pcts.uptimePct > 0 AND pcts.speedToOptimumPct > 0 AND pcts.qualityPct > 0
          THEN (pcts.uptimePct / 100.0) * (pcts.speedToOptimumPct / 100.0) * (pcts.qualityPct / 100.0) * 100
          ELSE 0 END as oeePct,
        1 as setupCount,
        base.orderHours
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          job_series_step_id,
          SUM(CASE WHEN waste_property != 0 THEN wasted_quantity ELSE 0 END) as total_waste
        FROM dwwaste
        GROUP BY job_series_step_id
      ) wps ON pf.feedback_job_series_step_id = wps.job_series_step_id
      LEFT JOIN (
        SELECT
          downtime_job_series_step_id,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as totalDowntimeHours,
          SUM(CASE WHEN check_downtime_crosses_shift = 'OK' AND downtime_within = 'SETUP'
               THEN CAST(downtime_duration_seconds AS FLOAT) / 3600.0 ELSE 0 END) as setupDowntimeHours
        FROM dwdowntimes
        GROUP BY downtime_job_series_step_id
      ) dt ON pf.feedback_job_series_step_id = dt.downtime_job_series_step_id
      OUTER APPLY (
        SELECT TOP 1 po2.customer_name, po2.spec_number
        FROM dwproductionorders po2
        WHERE po2.job_number = jss.feedback_job_number
      ) po
      CROSS APPLY (
        SELECT
          CAST(CASE WHEN cc.costcenter_number = 154 THEN 15000 ELSE cc.optimum_run_speed END AS FLOAT) as optimumSpeed,
          CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) / 3600.0 as orderHours,
          (CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) - CAST(pf.setup_duration_seconds AS FLOAT))
            / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) as runHours,
          (CAST(DATEDIFF(SECOND, jss.feedback_start, jss.feedback_finish) AS FLOAT) - CAST(pf.setup_duration_seconds AS FLOAT))
            / 3600.0 + ISNULL(dt.setupDowntimeHours, 0) - ISNULL(dt.totalDowntimeHours, 0) as uptimeHours,
          CAST(pf.quantity_produced AS FLOAT)
            * ISNULL(jss.number_up_exit_1, 1)
            / NULLIF(jss.number_up_entry_1, 0) as producedSheets,
          CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0
               ELSE CAST(ISNULL(wps.total_waste, 0) AS FLOAT)
          END as wasteSheets
      ) base
      CROSS APPLY (
        SELECT
          CASE WHEN base.runHours > 0 THEN base.uptimeHours / base.runHours * 100 ELSE 0 END as uptimePct,
          CASE WHEN base.uptimeHours > 0 AND base.optimumSpeed > 0
            THEN (CAST(pf.quantity_fed_in AS FLOAT) / base.uptimeHours) / base.optimumSpeed * 100
            ELSE 0 END as speedToOptimumPct,
          CASE WHEN (base.producedSheets + base.wasteSheets) > 0
            THEN base.producedSheets / (base.producedSheets + base.wasteSheets) * 100
            ELSE 0 END as qualityPct
      ) pcts
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${shiftWhere}
        ${ABOVE_OPTIMUM_FILTER}
      ORDER BY pf.feedback_report_date DESC
    `
  },

  qualityDetail: (hasMachine: boolean, hasShift: boolean) => {
    const machineWhere = hasMachine ? `AND cc.costcenter_number = @machine` : ''
    const shiftWhere = hasShift ? `AND jss.crew_id = @shift` : ''
    return `
      SELECT
        CONVERT(VARCHAR(10), DATEADD(DAY, -(DATEDIFF(DAY, '19000101', CAST(pf.feedback_report_date AS DATE)) % 7), CAST(pf.feedback_report_date AS DATE)), 23) as weekStartDate,
        CONVERT(VARCHAR(10), pf.feedback_report_date, 23) as feedbackDate,
        jss.feedback_job_number as jobNum,
        cc.costcenter_number as lineNumber,
        po.customer_name as customerName,
        po.spec_number as specNumber,
        CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0
             ELSE ISNULL(wps.total_waste, 0)
        END as reportedWaste,
        ISNULL(pf.prerun_waste, 0) as prerunWaste,
        CAST(pf.quantity_produced AS FLOAT)
          * ISNULL(jss.number_up_exit_1, 1)
          / NULLIF(jss.number_up_entry_1, 0) as producedSheets,
        CASE WHEN (CAST(pf.quantity_produced AS FLOAT)
          * ISNULL(jss.number_up_exit_1, 1)
          / NULLIF(jss.number_up_entry_1, 0)
          + CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0 ELSE ISNULL(wps.total_waste, 0) END) > 0
        THEN CAST(pf.quantity_produced AS FLOAT)
          * ISNULL(jss.number_up_exit_1, 1)
          / NULLIF(jss.number_up_entry_1, 0)
          / (CAST(pf.quantity_produced AS FLOAT)
            * ISNULL(jss.number_up_exit_1, 1)
            / NULLIF(jss.number_up_entry_1, 0)
            + CASE WHEN ISNULL(wps.total_waste, 0) > 200000 THEN 0 ELSE ISNULL(wps.total_waste, 0) END)
          * 100
        ELSE 0 END as qualityPct
      FROM dwproductionfeedback pf
      INNER JOIN dwjobseriesstep jss
        ON pf.feedback_job_series_step_id = jss.job_series_step_id
      INNER JOIN dwcostcenters cc
        ON pf.feedback_costcenter_id = cc.costcenter_id
      LEFT JOIN (
        SELECT
          job_series_step_id,
          SUM(CASE WHEN waste_property != 0 THEN wasted_quantity ELSE 0 END) as total_waste
        FROM dwwaste
        GROUP BY job_series_step_id
      ) wps ON pf.feedback_job_series_step_id = wps.job_series_step_id
      OUTER APPLY (
        SELECT TOP 1 po2.customer_name, po2.spec_number
        FROM dwproductionorders po2
        WHERE po2.job_number = jss.feedback_job_number
      ) po
      WHERE pf.feedback_report_date >= @startDate
        AND pf.feedback_report_date < @endDate
        AND pf.actual_run_duration_minutes != 0
        AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
        ${machineWhere}
        ${shiftWhere}
      ORDER BY pf.feedback_report_date DESC
    `
  },
}

// GET /api/erp/production/date-limits
productionDashboardRoutes.get('/date-limits', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'production:date-limits', CacheTTL.DATE_LIMITS, async () => {
      const sql = `
        SELECT
          CONVERT(VARCHAR(10), MIN(CAST(pf.feedback_report_date AS DATE)), 23) as minDate,
          CONVERT(VARCHAR(10), MAX(CAST(pf.feedback_report_date AS DATE)), 23) as maxDate
        FROM dwproductionfeedback pf
        INNER JOIN dwcostcenters cc
          ON pf.feedback_costcenter_id = cc.costcenter_id
        WHERE pf.actual_run_duration_minutes != 0
          AND cc.costcenter_number IN (130, 131, 132, 133, 142, 144, 146, 154)
      `
      return client.rawQuery(sql, {}, 'kdw')
    })
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/quality-summary?startDate=&endDate=&granularity=&machine=&shift=
productionDashboardRoutes.get('/quality-summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const granularity = c.req.query('granularity') || 'monthly'
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }
  if (!['daily', 'monthly', 'weekly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, monthly, weekly, or yearly' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = getQualitySummarySQL(granularity, hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/quality-by-machine?startDate=&endDate=&shift=
productionDashboardRoutes.get('/quality-by-machine', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.qualityByMachine(hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/quality-by-shift?startDate=&endDate=&machine=
productionDashboardRoutes.get('/quality-by-shift', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const sql = PRODUCTION_SQL.qualityByShift(hasMachine)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/waste-by-category?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/waste-by-category', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.wasteByCategory(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/speed-summary?startDate=&endDate=&granularity=&machine=&shift=
productionDashboardRoutes.get('/speed-summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const granularity = c.req.query('granularity') || 'monthly'
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }
  if (!['daily', 'monthly', 'weekly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, monthly, weekly, or yearly' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = getSpeedSummarySQL(granularity, hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/speed-by-machine?startDate=&endDate=&shift=
productionDashboardRoutes.get('/speed-by-machine', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.speedByMachine(hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/speed-by-shift?startDate=&endDate=&machine=
productionDashboardRoutes.get('/speed-by-shift', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const sql = PRODUCTION_SQL.speedByShift(hasMachine)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/uptime-summary?startDate=&endDate=&granularity=&machine=&shift=
productionDashboardRoutes.get('/uptime-summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const granularity = c.req.query('granularity') || 'monthly'
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }
  if (!['daily', 'monthly', 'weekly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, monthly, weekly, or yearly' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = getUptimeSummarySQL(granularity, hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/uptime-by-machine?startDate=&endDate=&shift=
productionDashboardRoutes.get('/uptime-by-machine', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.uptimeByMachine(hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/uptime-by-shift?startDate=&endDate=&machine=
productionDashboardRoutes.get('/uptime-by-shift', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const sql = PRODUCTION_SQL.uptimeByShift(hasMachine)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/oee-summary?startDate=&endDate=&granularity=&machine=&shift=
productionDashboardRoutes.get('/oee-summary', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const granularity = c.req.query('granularity') || 'monthly'
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }
  if (!['daily', 'monthly', 'weekly', 'yearly'].includes(granularity)) {
    return c.json({ error: 'granularity must be daily, monthly, weekly, or yearly' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = getOeeSummarySQL(granularity, hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/oee-by-machine?startDate=&endDate=&shift=
productionDashboardRoutes.get('/oee-by-machine', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.oeeByMachine(hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/oee-by-shift?startDate=&endDate=&machine=
productionDashboardRoutes.get('/oee-by-shift', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const sql = PRODUCTION_SQL.oeeByShift(hasMachine)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/speed-detail?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/speed-detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.speedDetail(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/speed-exceptions?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/speed-exceptions', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.speedExceptions(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/uptime-detail?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/uptime-detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.uptimeDetail(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/quality-detail?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/quality-detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.qualityDetail(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/oee-detail?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/oee-detail', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.oeeDetail(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/downtime-by-reason?startDate=&endDate=&machine=&shift=
productionDashboardRoutes.get('/downtime-by-reason', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const machine = c.req.query('machine') || ''
  const shift = c.req.query('shift') || ''
  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  try {
    const hasMachine = machine.length > 0
    const hasShift = shift.length > 0
    const sql = PRODUCTION_SQL.downtimeByReason(hasMachine, hasShift)
    const params: Record<string, unknown> = { startDate, endDate }
    if (hasMachine) params.machine = parseInt(machine, 10)
    if (hasShift) params.shift = shift
    const result = await client.rawQuery(sql, params, 'kdw')
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/machines
productionDashboardRoutes.get('/machines', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'production:machines', CacheTTL.LOOKUP_DATA, () =>
      client.rawQuery(PRODUCTION_SQL.machines, {}, 'kdw')
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})

// GET /api/erp/production/shifts
productionDashboardRoutes.get('/shifts', async (c) => {
  const client = getClient(c.env)
  if (!client) {
    return c.json({ error: 'Kiwiplan gateway not configured' }, 503)
  }

  try {
    const kv = c.env.AUTH_CACHE
    const result = await kvCache(kv, 'production:shifts', CacheTTL.LOOKUP_DATA, () =>
      client.rawQuery(PRODUCTION_SQL.shifts, {}, 'kdw')
    )
    return c.json(result)
  } catch (err) {
    if (err instanceof KiwiplanError) {
      return c.json({ error: err.message }, err.statusCode as 400)
    }
    throw err
  }
})
