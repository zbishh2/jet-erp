import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core'

export const emailVerification = sqliteTable('email_verification', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  code: text('code').notNull(),
  type: text('type').notNull(), // 'signup' | 'password_reset' | 'invite'
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  emailTypeIdx: index('email_verification_email_type_idx').on(table.email, table.type),
  expiresIdx: index('email_verification_expires_idx').on(table.expiresAt),
}))

export type EmailVerificationRecord = typeof emailVerification.$inferSelect
export type NewEmailVerificationRecord = typeof emailVerification.$inferInsert
