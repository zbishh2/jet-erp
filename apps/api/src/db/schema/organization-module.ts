import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'
import { module } from './module'

// Organization subscriptions to modules
export const organizationModule = sqliteTable('organization_module', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  moduleId: text('module_id').notNull().references(() => module.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  activatedAt: text('activated_at').notNull(),
  deactivatedAt: text('deactivated_at'),
  settings: text('settings'), // JSON string, parse manually
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  orgModuleIdx: uniqueIndex('org_module_idx').on(table.organizationId, table.moduleId),
  orgIdx: index('org_module_org_idx').on(table.organizationId),
  moduleIdx: index('org_module_module_idx').on(table.moduleId),
}))

export type OrganizationModuleRecord = typeof organizationModule.$inferSelect
export type NewOrganizationModuleRecord = typeof organizationModule.$inferInsert
