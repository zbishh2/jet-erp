import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

// D1 database client factory
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema })
}

export type Database = ReturnType<typeof createDb>

export { schema }
export * from './schema'
export { forOrg, forOrgActive, scopedDb } from './tenant-scope'
