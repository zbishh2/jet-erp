/**
 * Score Formula Evaluator
 *
 * Parses and evaluates Kiwiplan score formulas (ebxScoreFormula) to calculate
 * blank dimensions for corrugated box manufacturing.
 *
 * Formula syntax: segments separated by ";", each using L/W/D variables
 * with +, -, *, / operators and RoundDown()/RoundUp() functions.
 * Sum of all segments = total dimension in mm.
 */

import type { ScoreFormulaData } from '@/api/hooks/useKiwiplan'

// --- Flute code mapping ---
// basicBoardName (from ebxStandardBoard) → formula description prefix
const FLUTE_PREFIX: Record<string, string> = {
  B: 'B',
  C: 'C',
  D: 'BC',  // double-wall
  E: 'E',
  F: 'AC',  // double-wall
}

const INCHES_TO_MM = 25.4
const MM2_TO_SQFT = 1 / (304.8 * 304.8) // mm² to sq ft

export interface BlankResult {
  blankAreaSqFt: number
  blankLengthMm: number
  blankWidthMm: number
  formulaUsed: 'kiwiplan' | 'fallback'
}

/**
 * Calculate blank dimensions using Kiwiplan score formulas.
 *
 * Falls back to the hardcoded RSC formula when no matching formula is found.
 */
export function calcBlankDimensions(
  styleCode: string,
  basicBoardName: string | null | undefined,
  lengthIn: number,
  widthIn: number,
  depthIn: number,
  formulaData: ScoreFormulaData | undefined,
): BlankResult {
  if (!formulaData || !basicBoardName) {
    return fallbackRsc(lengthIn, widthIn, depthIn)
  }

  const flutePrefix = FLUTE_PREFIX[basicBoardName]
  if (!flutePrefix) {
    return fallbackRsc(lengthIn, widthIn, depthIn)
  }

  // Find style → formula group mapping
  const styleGroup = formulaData.styleGroups.find(
    (sg) => sg.code.toUpperCase() === styleCode.toUpperCase(),
  )
  if (!styleGroup || !styleGroup.lwGroupId || !styleGroup.wwGroupId) {
    return fallbackRsc(lengthIn, widthIn, depthIn)
  }

  // Find LW formula: match "{flutePrefix} GI" in group
  const lwFormulas = formulaData.formulas.filter(
    (f) => f.groupId === styleGroup.lwGroupId,
  )
  const lwFormula = findFormula(lwFormulas, flutePrefix, 'GI')

  // Find WW formula: match "{flutePrefix} RSC" (or style-appropriate suffix)
  const wwFormulas = formulaData.formulas.filter(
    (f) => f.groupId === styleGroup.wwGroupId,
  )
  const wwFormula = findFormula(wwFormulas, flutePrefix, 'RSC') ??
    findFormula(wwFormulas, flutePrefix, styleCode)

  if (!lwFormula || !wwFormula) {
    return fallbackRsc(lengthIn, widthIn, depthIn)
  }

  // Convert inches to mm for formula evaluation
  const L = lengthIn * INCHES_TO_MM
  const W = widthIn * INCHES_TO_MM
  const D = depthIn * INCHES_TO_MM

  const blankLengthMm = evaluateFormula(lwFormula.formula, L, W, D)
  const blankWidthMm = evaluateFormula(wwFormula.formula, L, W, D)

  if (blankLengthMm <= 0 || blankWidthMm <= 0) {
    return fallbackRsc(lengthIn, widthIn, depthIn)
  }

  return {
    blankAreaSqFt: blankLengthMm * blankWidthMm * MM2_TO_SQFT,
    blankLengthMm,
    blankWidthMm,
    formulaUsed: 'kiwiplan',
  }
}

/**
 * Find a formula whose description matches "{prefix} {suffix}" (case-insensitive).
 */
function findFormula(
  formulas: ScoreFormulaData['formulas'],
  flutePrefix: string,
  suffix: string,
) {
  const target = `${flutePrefix} ${suffix}`.toUpperCase()
  return formulas.find(
    (f) => f.formulaDescription?.toUpperCase().trim() === target,
  ) ?? formulas.find(
    (f) => f.formulaDescription?.toUpperCase().trim().startsWith(`${flutePrefix} `),
  )
}

/**
 * Evaluate a Kiwiplan score formula string.
 *
 * Formula = segments separated by ";".
 * Each segment can contain: L, W, D variables, numbers, +, -, *, /,
 * RoundDown(...), RoundUp(...), and F (tab width constant).
 *
 * Result = sum of all segment results in mm.
 */
export function evaluateFormula(
  formula: string,
  L: number,
  W: number,
  D: number,
): number {
  const segments = formula.split(';').map((s) => s.trim()).filter(Boolean)
  let total = 0
  for (const segment of segments) {
    total += evaluateExpression(segment, L, W, D)
  }
  return total
}

/**
 * Evaluate a single expression segment.
 *
 * Handles: RoundDown(expr), RoundUp(expr), variables L/W/D,
 * numeric literals, and arithmetic +, -, *, /.
 */
function evaluateExpression(expr: string, L: number, W: number, D: number): number {
  let s = expr.trim()
  if (!s) return 0

  // Handle RoundDown(...)
  const rdMatch = s.match(/^RoundDown\((.+)\)$/i)
  if (rdMatch) {
    return Math.floor(evaluateExpression(rdMatch[1], L, W, D))
  }

  // Handle RoundUp(...)
  const ruMatch = s.match(/^RoundUp\((.+)\)$/i)
  if (ruMatch) {
    return Math.ceil(evaluateExpression(ruMatch[1], L, W, D))
  }

  // Tokenize: split into numbers, variables, operators, and parenthesized groups
  // We use a simple left-to-right evaluation with operator precedence
  return parseAddSub(s, L, W, D)
}

// --- Simple recursive-descent parser for arithmetic ---

function parseAddSub(s: string, L: number, W: number, D: number): number {
  // Find the rightmost + or - that isn't inside parentheses
  let parenDepth = 0
  let lastOpIdx = -1
  let lastOp = ''

  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]
    if (ch === ')') parenDepth++
    else if (ch === '(') parenDepth--
    else if (parenDepth === 0 && (ch === '+' || ch === '-')) {
      // Skip if this is a unary minus at the start or after another operator
      if (i === 0) continue
      const prev = s[i - 1]
      if (prev === '*' || prev === '/' || prev === '(' || prev === '+' || prev === '-') continue
      lastOpIdx = i
      lastOp = ch
      break
    }
  }

  if (lastOpIdx >= 0) {
    const left = parseAddSub(s.slice(0, lastOpIdx), L, W, D)
    const right = parseMulDiv(s.slice(lastOpIdx + 1), L, W, D)
    return lastOp === '+' ? left + right : left - right
  }

  return parseMulDiv(s, L, W, D)
}

function parseMulDiv(s: string, L: number, W: number, D: number): number {
  let parenDepth = 0
  let lastOpIdx = -1
  let lastOp = ''

  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i]
    if (ch === ')') parenDepth++
    else if (ch === '(') parenDepth--
    else if (parenDepth === 0 && (ch === '*' || ch === '/')) {
      lastOpIdx = i
      lastOp = ch
      break
    }
  }

  if (lastOpIdx >= 0) {
    const left = parseMulDiv(s.slice(0, lastOpIdx), L, W, D)
    const right = parseAtom(s.slice(lastOpIdx + 1), L, W, D)
    return lastOp === '*' ? left * right : (right !== 0 ? left / right : 0)
  }

  return parseAtom(s, L, W, D)
}

function parseAtom(s: string, L: number, W: number, D: number): number {
  s = s.trim()
  if (!s) return 0

  // Handle RoundDown/RoundUp inside expressions
  const rdMatch = s.match(/^RoundDown\((.+)\)$/i)
  if (rdMatch) return Math.floor(evaluateExpression(rdMatch[1], L, W, D))
  const ruMatch = s.match(/^RoundUp\((.+)\)$/i)
  if (ruMatch) return Math.ceil(evaluateExpression(ruMatch[1], L, W, D))

  // Parenthesized expression
  if (s.startsWith('(') && s.endsWith(')')) {
    return evaluateExpression(s.slice(1, -1), L, W, D)
  }

  // Variables
  if (s === 'L') return L
  if (s === 'W') return W
  if (s === 'D') return D

  // Numeric literal
  const num = parseFloat(s)
  if (!isNaN(num)) return num

  return 0
}

// --- Fallback ---

function fallbackRsc(
  lengthIn: number,
  widthIn: number,
  depthIn: number,
): BlankResult {
  const tabSize = 1.5 // inches
  const blankLIn = 2 * lengthIn + 2 * widthIn + tabSize
  const blankWIn = widthIn + 2 * depthIn

  const blankLMm = blankLIn * INCHES_TO_MM
  const blankWMm = blankWIn * INCHES_TO_MM

  return {
    blankAreaSqFt: (blankLIn * blankWIn) / 144,
    blankLengthMm: blankLMm,
    blankWidthMm: blankWMm,
    formulaUsed: 'fallback',
  }
}
