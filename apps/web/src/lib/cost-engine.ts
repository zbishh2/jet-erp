/**
 * Cost Calculation Engine
 *
 * Pure TypeScript module — runs client-side for instant feedback.
 * Replicates Kiwiplan's cost estimation logic for corrugated box manufacturing.
 *
 * Key terminology:
 * - /M = per thousand pieces
 * - MSF = thousand square feet
 * - *DIRECT = sum of Board + OthMat + DirLab + DirMfg + Trucking
 * - *PLANT = *DIRECT + FixMfg + Whse
 * - *100DEX = *PLANT + SGA+ (total cost at 100% index)
 */

import { calcBlankDimensions, type BlankResult } from './score-formula'
import type { ScoreFormulaData } from '@/api/hooks/useKiwiplan'

// --- Input Types ---

export interface MachineStep {
  machineName: string
  machineNumber: number
  sequenceNumber: number
  runRate: number          // pieces per hour
  setupMins: number        // minutes
  laborRate: number        // $/hr (from cstPlantRate costRate for labor rules)
  mfgRate: number          // $/hr (from cstPlantRate costRate for mfg overhead rules)
}

export interface CostInputs {
  // Product spec
  length: number           // inches (internal)
  width: number            // inches (internal)
  depth: number            // inches (internal)
  boardCostPerMSF: number  // $/MSF from ebxStandardBoard.costPerArea
  boardDensity: number     // lbs/MSF from ebxStandardBoard.density
  inkCoveragePercent: number // 0-100
  isHalfUp: boolean        // 2-up on the corrugator
  isGlued: boolean         // default true unless die cut

  // Routing (from gateway)
  machineSteps: MachineStep[]

  // Freight
  shippingMethod: 'freight' | 'cpu'
  freightPer: number       // $/cwt from orgFreightZone.freightper
  journeyDistance: number   // miles

  // Rates (from gateway / config)
  inkStdRate: number        // $/MSF at 100% coverage
  glueCostPerPiece: number  // $ per piece (typically small, e.g. 0.002)
  sgaPercent: number        // SG&A as % of *PLANT (typically 15-20%)
  fixedMfgPercent: number   // Fixed Mfg overhead as % of direct mfg (typically 30-50%)

  // Order
  quantity: number          // total pieces

  // Score formula (optional — enables flute-aware blank area)
  styleCode?: string
  basicBoardName?: string | null
  formulaData?: ScoreFormulaData

  // Manual blank area override (sq ft) — bypasses formula calculation
  blankAreaOverride?: number | null
}

export interface CostResult {
  // Per-M costs by category
  board: number
  othMat: number
  dirLab: number
  dirMfg: number
  trucking: number
  direct: number           // *DIRECT subtotal

  fixMfg: number
  whse: number
  plant: number            // *PLANT subtotal

  sgaPlus: number
  total: number            // *100DEX

  // Setup costs (one-time)
  setupCost: number

  // Physical
  blankAreaSqFt: number    // area per piece in sq ft
  totalSqFt: number        // total sq ft for order
  totalWeight: number       // total lbs for order
  weightPerM: number        // lbs per thousand pieces

  // Metrics
  machineHours: number      // total machine hours for order
  pricePerM: number         // = total (at 100% index)

  // Formula source
  formulaUsed: 'kiwiplan' | 'fallback'
}

// --- Calculation ---

/**
 * Calculate all costs from inputs.
 *
 * Returns a full CostResult with per-M costs, setup, physical metrics.
 */
export function calculateCosts(inputs: CostInputs): CostResult {
  const {
    length, width, depth,
    boardCostPerMSF, boardDensity,
    inkCoveragePercent, isHalfUp, isGlued,
    machineSteps,
    shippingMethod, freightPer, journeyDistance,
    inkStdRate, glueCostPerPiece, sgaPercent, fixedMfgPercent,
    quantity,
    styleCode, basicBoardName, formulaData,
    blankAreaOverride,
  } = inputs

  const qtyM = quantity / 1000 // quantity in thousands

  // --- Physical ---
  const blank: BlankResult = (blankAreaOverride && blankAreaOverride > 0)
    ? { blankAreaSqFt: blankAreaOverride, blankLengthMm: 0, blankWidthMm: 0, formulaUsed: 'fallback' as const }
    : calcBlankDimensions(styleCode ?? '', basicBoardName, length, width, depth, formulaData)
  const blankAreaSqFt = blank.blankAreaSqFt
  const areaMSF = blankAreaSqFt // area per piece in sq ft = area/MSF when × 1000 pieces
  // For 1000 pieces: total area = blankAreaSqFt * 1000 sq ft = blankAreaSqFt MSF
  // So areaMSF (area of 1M pieces in MSF) = blankAreaSqFt

  const totalSqFt = blankAreaSqFt * quantity
  const weightPerM = boardDensity * areaMSF  // lbs per M pieces
  const totalWeight = weightPerM * qtyM

  // --- Board Cost ---
  // boardCostPerMSF is $/MSF. For 1M pieces, we use areaMSF worth of board.
  const boardPerM = boardCostPerMSF * areaMSF

  // --- Other Materials ---
  const halfUpMultiplier = isHalfUp ? 0.5 : 1.0
  const inkPerM = inkStdRate * areaMSF * (inkCoveragePercent / 100) * halfUpMultiplier
  const gluePerM = isGlued ? glueCostPerPiece * 1000 : 0
  const othMatPerM = inkPerM + gluePerM

  // --- Labor & Mfg (from routing) ---
  let totalLaborPerM = 0
  let totalMfgPerM = 0
  let totalSetupCost = 0
  let totalMachineHours = 0

  for (const step of machineSteps) {
    if (step.runRate <= 0) continue

    const runHoursPerM = 1000 / step.runRate // hours to produce 1M pieces
    const setupHours = step.setupMins / 60

    totalLaborPerM += step.laborRate * runHoursPerM
    totalMfgPerM += step.mfgRate * runHoursPerM

    // Setup is a one-time cost
    totalSetupCost += (step.laborRate + step.mfgRate) * setupHours

    // Machine hours for the full order
    totalMachineHours += setupHours + (runHoursPerM * qtyM)
  }

  // --- Freight ---
  let truckingPerM = 0
  if (shippingMethod === 'freight' && journeyDistance > 0 && freightPer > 0) {
    // freightPer is $/cwt (per 100 lbs)
    truckingPerM = freightPer * (weightPerM / 100)
  }

  // --- Subtotals ---
  const directPerM = boardPerM + othMatPerM + totalLaborPerM + totalMfgPerM + truckingPerM

  // Fixed manufacturing overhead
  const fixMfgPerM = totalMfgPerM * (fixedMfgPercent / 100)
  const whsePerM = 0 // warehouse cost — placeholder, usually from config

  const plantPerM = directPerM + fixMfgPerM + whsePerM

  // SG&A
  const sgaPlusPerM = plantPerM * (sgaPercent / 100)

  // Total = *100DEX
  const totalPerM = plantPerM + sgaPlusPerM

  return {
    board: boardPerM,
    othMat: othMatPerM,
    dirLab: totalLaborPerM,
    dirMfg: totalMfgPerM,
    trucking: truckingPerM,
    direct: directPerM,

    fixMfg: fixMfgPerM,
    whse: whsePerM,
    plant: plantPerM,

    sgaPlus: sgaPlusPerM,
    total: totalPerM,

    setupCost: totalSetupCost,

    blankAreaSqFt,
    totalSqFt,
    totalWeight,
    weightPerM,

    machineHours: totalMachineHours,
    pricePerM: totalPerM,  // at 100% index, price = total cost

    formulaUsed: blank.formulaUsed,
  }
}

/**
 * Create default CostInputs with reasonable placeholder values.
 */
export function defaultCostInputs(): CostInputs {
  return {
    length: 12,
    width: 10,
    depth: 8,
    boardCostPerMSF: 0,
    boardDensity: 0,
    inkCoveragePercent: 0,
    isHalfUp: false,
    isGlued: true,
    machineSteps: [],
    shippingMethod: 'freight',
    freightPer: 0,
    journeyDistance: 0,
    inkStdRate: 0,
    glueCostPerPiece: 0.002,
    sgaPercent: 18,
    fixedMfgPercent: 35,
    quantity: 5000,
  }
}
