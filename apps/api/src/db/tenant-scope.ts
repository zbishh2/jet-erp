/**
 * Tenant Isolation Utilities
 *
 * Provides type-safe helpers to enforce organization-scoped queries.
 * D1/SQLite doesn't support row-level security, so all tenant isolation
 * is enforced at the application layer. These utilities make it harder
 * to accidentally omit the organizationId filter.
 *
 * Usage:
 *   import { forOrg, scopedDb } from '../db/tenant-scope'
 *
 *   // Option 1: Drop-in helper for existing queries
 *   const ncrs = await db.select().from(ncr)
 *     .where(and(forOrg(ncr, orgId), isNull(ncr.deletedAt)))
 *
 *   // Option 2: Pre-scoped query builder
 *   const scoped = scopedDb(db, orgId)
 *   const ncrs = await scoped.findMany(ncr)
 *   const oneNcr = await scoped.findById(ncr, id)
 */

import { eq, and, isNull, type SQL } from 'drizzle-orm'
import type { SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core'
import type { Database } from './index'

// Any table that has an organizationId column
type OrgScopedTable = SQLiteTableWithColumns<any> & {
  organizationId: any
}

// Any table that also has a deletedAt column
type SoftDeletableTable = OrgScopedTable & {
  deletedAt: any
}

/**
 * Returns an eq() filter for a table's organizationId column.
 * Use this as a drop-in replacement in existing where() clauses.
 *
 * @example
 *   db.select().from(ncr).where(and(forOrg(ncr, orgId), ...otherConditions))
 */
export function forOrg<T extends OrgScopedTable>(table: T, orgId: string) {
  return eq(table.organizationId, orgId)
}

/**
 * Returns org + soft-delete filters as a tuple for spreading into conditions arrays.
 *
 * IMPORTANT: Use spread syntax when combining with other conditions, since this
 * returns two separate SQL conditions (not a nested and()).
 *
 * @example
 *   // In a .where() call directly:
 *   db.select().from(ncr).where(and(...forOrgActive(ncr, orgId)))
 *
 *   // In a conditions array (preferred pattern):
 *   const conditions = [...forOrgActive(ncr, orgId)]
 *   conditions.push(eq(ncr.status, 'OPEN'))
 *   db.select().from(ncr).where(and(...conditions))
 */
export function forOrgActive<T extends SoftDeletableTable>(table: T, orgId: string) {
  return [eq(table.organizationId, orgId), isNull(table.deletedAt)] as const
}

/**
 * Pre-scoped query builder that automatically injects organizationId filtering.
 * Provides common query patterns that are impossible to use without org scoping.
 *
 * @example
 *   const scoped = scopedDb(db, auth.organizationId)
 *
 *   // List all active records
 *   const ncrs = await scoped.findMany(ncr)
 *
 *   // List with extra conditions
 *   const openNcrs = await scoped.findMany(ncr, eq(ncr.status, 'OPEN'))
 *
 *   // Find by ID (returns first match or undefined)
 *   const oneNcr = await scoped.findById(ncr, ncrId)
 *
 *   // Tables without deletedAt
 *   const sites = await scoped.findManyIncludeAll(site)
 */
export function scopedDb(db: Database, orgId: string) {
  return {
    /**
     * SELECT * FROM table WHERE organizationId = orgId AND deletedAt IS NULL
     * Optionally add extra where conditions.
     * Use for tables WITH a deletedAt column.
     */
    findMany: async <T extends SoftDeletableTable>(
      table: T,
      ...extraConditions: (SQL | undefined)[]
    ) => {
      const conditions = [
        ...forOrgActive(table, orgId),
        ...extraConditions.filter(Boolean),
      ]
      return db.select().from(table).where(and(...conditions))
    },

    /**
     * SELECT * FROM table WHERE id = id AND organizationId = orgId AND deletedAt IS NULL
     * Use for tables WITH a deletedAt column.
     */
    findById: async <T extends SoftDeletableTable & { id: any }>(
      table: T,
      id: string,
    ) => {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), ...forOrgActive(table, orgId)))
        .limit(1)
      return rows[0]
    },

    /**
     * SELECT * FROM table WHERE organizationId = orgId
     * Use for tables WITHOUT a deletedAt column (sites, departments, etc.).
     */
    findManyAll: async <T extends OrgScopedTable>(
      table: T,
      ...extraConditions: (SQL | undefined)[]
    ) => {
      const conditions = [
        forOrg(table, orgId),
        ...extraConditions.filter(Boolean),
      ]
      return db.select().from(table).where(and(...conditions))
    },

    /**
     * SELECT * FROM table WHERE id = id AND organizationId = orgId
     * Use for tables WITHOUT a deletedAt column.
     */
    findByIdAll: async <T extends OrgScopedTable & { id: any }>(
      table: T,
      id: string,
    ) => {
      const rows = await db
        .select()
        .from(table)
        .where(and(eq(table.id, id), forOrg(table, orgId)))
        .limit(1)
      return rows[0]
    },

    /** The underlying org ID for manual queries that need it. */
    orgId,
  }
}
