import { sqliteTable, text, real, index } from 'drizzle-orm/sqlite-core'

export const salesBudget = sqliteTable('sales_budget', {
  id: text('id').primaryKey(),
  salesRep: text('sales_rep').notNull(),
  month: text('month').notNull(), // ISO date 'YYYY-MM-01'
  budgetedDollars: real('budgeted_dollars').notNull().default(0),
  budgetedMsf: real('budgeted_msf').notNull().default(0),
  budgetedContribution: real('budgeted_contribution').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  repMonthIdx: index('idx_sales_budget_rep_month').on(table.salesRep, table.month),
}))

export type SalesBudgetRecord = typeof salesBudget.$inferSelect
export type NewSalesBudgetRecord = typeof salesBudget.$inferInsert
