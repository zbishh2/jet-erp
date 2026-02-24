import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'
import { user } from './user'
import { module } from './module'

// User access to modules within organizations (module-scoped permissions)
export const userOrganizationModule = sqliteTable('user_organization_module', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  moduleId: text('module_id').notNull().references(() => module.id),
  role: text('role').notNull(), // 'ADMIN', 'QUALITY', 'REPORTER', etc.
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  grantedAt: text('granted_at').notNull(),
  grantedByUserId: text('granted_by_user_id').references(() => user.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  userOrgModuleRoleIdx: uniqueIndex('user_org_module_role_idx').on(table.userId, table.organizationId, table.moduleId, table.role),
  userIdx: index('user_org_module_user_idx').on(table.userId),
  orgIdx: index('user_org_module_org_idx').on(table.organizationId),
  moduleIdx: index('user_org_module_module_idx').on(table.moduleId),
}))

export type UserOrganizationModuleRecord = typeof userOrganizationModule.$inferSelect
export type NewUserOrganizationModuleRecord = typeof userOrganizationModule.$inferInsert
