import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'
import { user } from './user'

export const erpQuote = sqliteTable('erp_quote', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  quoteNumber: text('quote_number').notNull(),
  customerId: integer('customer_id').notNull(),
  customerName: text('customer_name').notNull(),
  shipToAddressId: integer('ship_to_address_id'),
  shippingMethod: text('shipping_method').notNull().default('freight'),
  status: text('status').notNull().default('draft'),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  updatedAt: text('updated_at').notNull(),
  updatedByUserId: text('updated_by_user_id').notNull().references(() => user.id),
  deletedAt: text('deleted_at'),
  deletedByUserId: text('deleted_by_user_id').references(() => user.id),
}, (table) => ({
  orgIdx: index('erp_quote_org_idx').on(table.organizationId),
  statusIdx: index('erp_quote_status_idx').on(table.status),
  customerIdx: index('erp_quote_customer_idx').on(table.customerId),
  createdByIdx: index('erp_quote_created_by_idx').on(table.createdByUserId),
  quoteNumberIdx: uniqueIndex('erp_quote_number_idx').on(table.organizationId, table.quoteNumber),
}))

export type ErpQuoteRecord = typeof erpQuote.$inferSelect
export type NewErpQuoteRecord = typeof erpQuote.$inferInsert

export const erpQuoteLine = sqliteTable('erp_quote_line', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull().references(() => erpQuote.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),
  description: text('description'),
  quantity: integer('quantity').notNull().default(5000),
  boxStyle: text('box_style'),
  length: real('length'),
  width: real('width'),
  depth: real('depth'),
  boardGradeId: integer('board_grade_id'),
  boardGradeCode: text('board_grade_code'),
  inkCoveragePercent: real('ink_coverage_percent').default(0),
  isGlued: integer('is_glued').notNull().default(1),
  costSnapshot: text('cost_snapshot'),  // JSON of full CostResult
  pricePerM: real('price_per_m'),
  qtyPerHour: real('qty_per_hour'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  quoteIdx: index('erp_quote_line_quote_idx').on(table.quoteId),
  lineNumberIdx: uniqueIndex('erp_quote_line_number_idx').on(table.quoteId, table.lineNumber),
}))

export type ErpQuoteLineRecord = typeof erpQuoteLine.$inferSelect
export type NewErpQuoteLineRecord = typeof erpQuoteLine.$inferInsert
