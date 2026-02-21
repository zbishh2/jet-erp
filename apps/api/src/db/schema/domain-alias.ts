import { sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'

/**
 * Domain aliases allow organizations to configure multiple email domains
 * that should be treated as equivalent for invite matching during SSO.
 *
 * For example, if terrasmart.com and rbi.gibraltar1.com are aliases,
 * an invite sent to user@terrasmart.com will accept SSO login from user@rbi.gibraltar1.com
 * (assuming same username).
 */
export const domainAlias = sqliteTable('domain_alias', {
  organizationId: text('organization_id').notNull().references(() => organization.id),
  domain: text('domain').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.organizationId, table.domain] }),
  domainIdx: index('domain_alias_domain_idx').on(table.domain),
}))

export type DomainAliasRecord = typeof domainAlias.$inferSelect
export type NewDomainAliasRecord = typeof domainAlias.$inferInsert
