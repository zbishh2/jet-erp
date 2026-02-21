/**
 * What-If Solver
 *
 * Given a target metric, solve for the required Price/M.
 * Each target type has a closed-form equation — no iteration needed.
 *
 * Terminology:
 * - Cont$ = Price/M - *DIRECT (contribution dollars per M)
 * - Cont% = Cont$ / Price/M × 100 (contribution percentage)
 * - Cont$/Hr = Cont$ × (qty/1000) / machineHours (contribution per machine hour)
 * - Index = Cont$/Hr / plantTarget × 100 (performance index)
 */

import type { CostResult } from './cost-engine'

export type SolverTarget =
  | { type: 'pricePerM'; value: number }
  | { type: 'contDollars'; value: number }
  | { type: 'contPercent'; value: number }
  | { type: 'contPerHour'; value: number; quantity: number }
  | { type: 'index'; value: number; plantTarget: number; quantity: number }

/**
 * Solve for Price/M given a target metric and cost breakdown.
 *
 * @param target - The target metric and desired value
 * @param costs - The current cost calculation result
 * @returns The Price/M that achieves the target
 */
export function solveForPrice(target: SolverTarget, costs: CostResult): number {
  switch (target.type) {
    case 'pricePerM':
      // Direct set — Price/M is the value itself
      return target.value

    case 'contDollars':
      // Cont$ = Price/M - *DIRECT → Price/M = Cont$ + *DIRECT
      return target.value + costs.direct

    case 'contPercent': {
      // Cont% = (Price/M - *DIRECT) / Price/M × 100
      // Cont%/100 × Price/M = Price/M - *DIRECT
      // *DIRECT = Price/M × (1 - Cont%/100)
      // Price/M = *DIRECT / (1 - Cont%/100)
      const fraction = target.value / 100
      if (fraction >= 1) return Infinity // Can't achieve 100%+ contribution
      return costs.direct / (1 - fraction)
    }

    case 'contPerHour': {
      // Cont$/Hr = Cont$ × (qty/1000) / machHrs
      // Cont$ = Cont$/Hr × machHrs / (qty/1000)
      // Price/M = Cont$ + *DIRECT
      const qtyM = target.quantity / 1000
      if (qtyM <= 0 || costs.machineHours <= 0) return costs.direct
      const contDollars = target.value * costs.machineHours / qtyM
      return contDollars + costs.direct
    }

    case 'index': {
      // Index = Cont$/Hr / plantTarget × 100
      // Cont$/Hr = Index/100 × plantTarget
      // Then solve as contPerHour
      const contPerHour = (target.value / 100) * target.plantTarget
      const qtyM = target.quantity / 1000
      if (qtyM <= 0 || costs.machineHours <= 0) return costs.direct
      const contDollars = contPerHour * costs.machineHours / qtyM
      return contDollars + costs.direct
    }
  }
}

/**
 * Calculate contribution metrics from Price/M and costs.
 */
export interface ContributionMetrics {
  pricePerM: number
  contDollars: number      // Price/M - *DIRECT
  contPercent: number       // Cont$ / Price/M × 100
  contPerHour: number       // Cont$ × (qty/1000) / machHrs
  index: number             // Cont$/Hr / plantTarget × 100
  totalPrice: number        // Price/M × qty/1000 + setupCost
  dollarPerMSF: number      // Price/M / blankAreaSqFt (if > 0)
}

export function calcContribution(
  pricePerM: number,
  costs: CostResult,
  quantity: number,
  plantTarget: number
): ContributionMetrics {
  const qtyM = quantity / 1000
  const contDollars = pricePerM - costs.direct
  const contPercent = pricePerM > 0 ? (contDollars / pricePerM) * 100 : 0
  const contPerHour = costs.machineHours > 0 ? (contDollars * qtyM) / costs.machineHours : 0
  const index = plantTarget > 0 ? (contPerHour / plantTarget) * 100 : 0
  const totalPrice = (pricePerM * qtyM) + costs.setupCost
  const dollarPerMSF = costs.blankAreaSqFt > 0 ? pricePerM / costs.blankAreaSqFt : 0

  return {
    pricePerM,
    contDollars,
    contPercent,
    contPerHour,
    index,
    totalPrice,
    dollarPerMSF,
  }
}
