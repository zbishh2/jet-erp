import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

// Platform modules that organizations can subscribe to
export const module = sqliteTable('module', {
  id: text('id').primaryKey(),
  code: text('code').unique().notNull(), // 'qms', 'workflow', etc.
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'), // Lucide icon name
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  codeIdx: index('module_code_idx').on(table.code),
}))

export type ModuleRecord = typeof module.$inferSelect
export type NewModuleRecord = typeof module.$inferInsert
