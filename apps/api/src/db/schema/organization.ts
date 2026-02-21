import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'

export const organization = sqliteTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  domain: text('domain').unique(),
  entraTenantId: text('entra_tenant_id').unique(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  settings: text('settings', { mode: 'json' }).default('{}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  entraTenantIdx: index('org_entra_tenant_idx').on(table.entraTenantId),
}))

export type OrganizationRecord = typeof organization.$inferSelect
export type NewOrganizationRecord = typeof organization.$inferInsert
