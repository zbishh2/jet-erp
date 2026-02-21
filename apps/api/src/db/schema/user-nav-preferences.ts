import { sqliteTable, text, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'
import { user } from './user'

// User navigation preferences per organization and module
export const userNavPreferences = sqliteTable('user_nav_preferences', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  moduleCode: text('module_code').notNull(), // 'qms', 'workflow', etc.
  navItems: text('nav_items').notNull(), // JSON: [{ key: 'ncr', visible: true, order: 0 }, ...]
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  userOrgModuleIdx: uniqueIndex('user_nav_pref_idx').on(table.userId, table.organizationId, table.moduleCode),
  userIdx: index('user_nav_pref_user_idx').on(table.userId),
  orgIdx: index('user_nav_pref_org_idx').on(table.organizationId),
}))

export type UserNavPreferencesRecord = typeof userNavPreferences.$inferSelect
export type NewUserNavPreferencesRecord = typeof userNavPreferences.$inferInsert
