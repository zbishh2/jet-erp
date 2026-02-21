import { sqliteTable, text, primaryKey } from 'drizzle-orm/sqlite-core'
import { user } from './user'

export const role = sqliteTable('role', {
  id: text('id').primaryKey(),
  name: text('name').unique().notNull(),
  description: text('description'),
})

export const userRole = sqliteTable('user_role', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  roleId: text('role_id').notNull().references(() => role.id, { onDelete: 'cascade' }),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.roleId] }),
}))

export type RoleRecord = typeof role.$inferSelect
export type NewRoleRecord = typeof role.$inferInsert
export type UserRoleRecord = typeof userRole.$inferSelect
export type NewUserRoleRecord = typeof userRole.$inferInsert
