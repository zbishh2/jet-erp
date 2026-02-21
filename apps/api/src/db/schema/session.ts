import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { user } from './user'

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id),
  token: text('token').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
}, (table) => ({
  userIdx: index('session_user_idx').on(table.userId),
  tokenIdx: index('session_token_idx').on(table.token),
  expiresIdx: index('session_expires_idx').on(table.expiresAt),
}))

export type SessionRecord = typeof session.$inferSelect
export type NewSessionRecord = typeof session.$inferInsert
