import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const holiday = sqliteTable('holiday', {
  id: text('id').primaryKey(),
  holidayDate: text('holiday_date').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  dateIdx: uniqueIndex('idx_holiday_date').on(table.holidayDate),
}))

export type HolidayRecord = typeof holiday.$inferSelect
export type NewHolidayRecord = typeof holiday.$inferInsert
