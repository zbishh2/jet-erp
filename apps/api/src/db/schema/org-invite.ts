import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'

export const orgInvite = sqliteTable('org_invite', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  email: text('email').notNull(),
  role: text('role').notNull(), // 'ADMIN' | 'QUALITY' | 'REPORTER' etc.
  token: text('token').notNull().unique(),
  invitedBy: text('invited_by').notNull(), // user_id who created invite
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'), // null until invite is accepted
  usedByEmail: text('used_by_email'), // email of who actually accepted (may differ from invite email)
  createdAt: text('created_at').notNull(),
}, (table) => ({
  orgEmailIdx: index('org_invite_org_email_idx').on(table.organizationId, table.email),
  tokenIdx: index('org_invite_token_idx').on(table.token),
}))

export type OrgInviteRecord = typeof orgInvite.$inferSelect
export type NewOrgInviteRecord = typeof orgInvite.$inferInsert
