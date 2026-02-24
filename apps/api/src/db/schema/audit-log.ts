import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'
import { user } from './user'

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => user.id),
  action: text('action').notNull(), // e.g. 'user.invite', 'user.deactivate', 'quote.create', 'sql_explorer.query'
  resource: text('resource').notNull(), // e.g. 'user', 'quote', 'invite', 'sql_explorer'
  resourceId: text('resource_id'), // ID of the affected resource (nullable for list/search actions)
  metadata: text('metadata'), // JSON string with action-specific details
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  userIdx: index('audit_log_user_idx').on(table.userId),
  actionIdx: index('audit_log_action_idx').on(table.action),
  resourceIdx: index('audit_log_resource_idx').on(table.resource, table.resourceId),
  createdAtIdx: index('audit_log_created_at_idx').on(table.createdAt),
}))

export type AuditLogRecord = typeof auditLog.$inferSelect
export type NewAuditLogRecord = typeof auditLog.$inferInsert
