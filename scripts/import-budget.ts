/**
 * One-time budget import script.
 *
 * Parses the budget spreadsheet and outputs SQL INSERT statements.
 * Run: npx tsx scripts/import-budget.ts > budget-inserts.sql
 * Then apply via wrangler: wrangler d1 execute <DB_NAME> --file budget-inserts.sql
 *
 * Or run with --api flag to insert via the API directly.
 *
 * Usage:
 *   npx tsx scripts/import-budget.ts
 */

import * as XLSX from 'xlsx'
import * as path from 'path'
import * as crypto from 'crypto'

const XLSX_PATH = path.resolve(__dirname, '../Import 2-20-2026 6-18-17 PM.xlsx')

interface BudgetRow {
  salesRep: string
  month: string // ISO date YYYY-MM-01
  budgetedDollars: number
  budgetedMsf: number
  budgetedContribution: number
}

function parseSpreadsheet(filePath: string): BudgetRow[] {
  const workbook = XLSX.readFile(filePath)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)

  // Accumulate per rep+month (sum duplicates)
  const accumulated = new Map<string, BudgetRow>()

  for (const row of rows) {
    // Flexible column name matching
    const salesRep = String(
      row['Sales Rep'] ?? row['SalesRep'] ?? row['sales_rep'] ?? row['Rep'] ?? ''
    ).trim()

    if (!salesRep) continue

    // Parse month - could be a date serial, date string, or "YYYY-MM-DD"
    let monthStr = ''
    const monthRaw = row['Month'] ?? row['month'] ?? row['Date'] ?? row['date']

    if (typeof monthRaw === 'number') {
      // Excel date serial number
      const date = XLSX.SSF.parse_date_code(monthRaw)
      monthStr = `${date.y}-${String(date.m).padStart(2, '0')}-01`
    } else if (monthRaw instanceof Date) {
      monthStr = `${monthRaw.getFullYear()}-${String(monthRaw.getMonth() + 1).padStart(2, '0')}-01`
    } else if (typeof monthRaw === 'string') {
      // Try to parse various formats
      const d = new Date(monthRaw)
      if (!isNaN(d.getTime())) {
        monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      } else {
        console.error(`Unparseable month: ${monthRaw}`)
        continue
      }
    } else {
      continue
    }

    const budgetedDollars = Number(
      row['Budgeted Dollars'] ?? row['BudgetedDollars'] ?? row['budgeted_dollars'] ?? 0
    )
    const budgetedMsf = Number(
      row['Budgeted MSF'] ?? row['BudgetedMSF'] ?? row['budgeted_msf'] ?? 0
    )
    const budgetedContribution = Number(
      row['Budgeted Contribution $'] ?? row['Budgeted Contribution'] ??
      row['BudgetedContribution'] ?? row['budgeted_contribution'] ?? 0
    )

    const key = `${salesRep}|${monthStr}`
    const existing = accumulated.get(key)

    if (existing) {
      existing.budgetedDollars += budgetedDollars
      existing.budgetedMsf += budgetedMsf
      existing.budgetedContribution += budgetedContribution
    } else {
      accumulated.set(key, {
        salesRep,
        month: monthStr,
        budgetedDollars,
        budgetedMsf,
        budgetedContribution,
      })
    }
  }

  return Array.from(accumulated.values())
}

function generateSQL(rows: BudgetRow[]): string {
  const now = new Date().toISOString()
  const lines: string[] = [
    '-- Sales Budget Import',
    `-- Generated: ${now}`,
    `-- Rows: ${rows.length}`,
    '',
    'DELETE FROM sales_budget;',
    '',
  ]

  for (const row of rows) {
    const id = crypto.randomUUID()
    const salesRep = row.salesRep.replace(/'/g, "''")
    lines.push(
      `INSERT INTO sales_budget (id, sales_rep, month, budgeted_dollars, budgeted_msf, budgeted_contribution, created_at, updated_at) VALUES ('${id}', '${salesRep}', '${row.month}', ${row.budgetedDollars}, ${row.budgetedMsf}, ${row.budgetedContribution}, '${now}', '${now}');`
    )
  }

  return lines.join('\n')
}

// Main
const rows = parseSpreadsheet(XLSX_PATH)
console.error(`Parsed ${rows.length} budget rows (duplicates summed)`)
console.log(generateSQL(rows))
