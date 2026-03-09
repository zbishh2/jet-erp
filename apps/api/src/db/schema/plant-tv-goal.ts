import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const plantTvGoal = sqliteTable('plant_tv_goal', {
  id: text('id').primaryKey(),
  machine: integer('machine').notNull().unique(),
  pct85: real('pct_85').notNull(),
  pct90: real('pct_90').notNull(),
  pct100: real('pct_100').notNull(),
  pct112: real('pct_112').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  machineIdx: index('idx_plant_tv_goal_machine').on(table.machine),
}))

export type PlantTvGoalRecord = typeof plantTvGoal.$inferSelect
export type NewPlantTvGoalRecord = typeof plantTvGoal.$inferInsert
