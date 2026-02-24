import { sqliteTable, text, index, integer } from 'drizzle-orm/sqlite-core'

export const authEvent = sqliteTable('auth_event', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(), // 'login_success', 'login_failed', 'signup', 'logout', 'password_reset', 'session_expired', 'account_locked'
  email: text('email'), // nullable for anonymous events
  userId: text('user_id'), // nullable for failed logins where user doesn't exist
  success: integer('success', { mode: 'boolean' }).notNull(),
  failureReason: text('failure_reason'), // e.g. 'invalid_password', 'account_deactivated', 'rate_limited'
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  emailIdx: index('auth_event_email_idx').on(table.email),
  userIdx: index('auth_event_user_idx').on(table.userId),
  eventTypeIdx: index('auth_event_type_idx').on(table.eventType),
  createdAtIdx: index('auth_event_created_at_idx').on(table.createdAt),
  ipIdx: index('auth_event_ip_idx').on(table.ipAddress),
}))

export type AuthEventRecord = typeof authEvent.$inferSelect
export type NewAuthEventRecord = typeof authEvent.$inferInsert
