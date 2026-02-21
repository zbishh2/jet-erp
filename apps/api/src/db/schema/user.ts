import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  entraObjectId: text('entra_object_id'), // nullable - only set for SSO users
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  jobTitle: text('job_title'), // e.g., "Quality Manager", "Engineer"
  passwordHash: text('password_hash'), // nullable - only set for email/password users
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isPlatformAdmin: integer('is_platform_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (table) => ({
  orgEntraIdx: uniqueIndex('user_org_entra_idx').on(table.organizationId, table.entraObjectId),
  orgEmailIdx: uniqueIndex('user_org_email_idx').on(table.organizationId, table.email),
  emailIdx: index('user_email_idx').on(table.email),
}))

export type UserRecord = typeof user.$inferSelect
export type NewUserRecord = typeof user.$inferInsert
