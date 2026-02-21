import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'
import { user } from './user'

// User memberships in organizations (many-to-many)
export const userOrganization = sqliteTable('user_organization', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  joinedAt: text('joined_at').notNull(),
  invitedByUserId: text('invited_by_user_id').references(() => user.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  userOrgIdx: uniqueIndex('user_org_idx').on(table.userId, table.organizationId),
  userIdx: index('user_org_user_idx').on(table.userId),
  orgIdx: index('user_org_org_idx').on(table.organizationId),
}))

export type UserOrganizationRecord = typeof userOrganization.$inferSelect
export type NewUserOrganizationRecord = typeof userOrganization.$inferInsert
