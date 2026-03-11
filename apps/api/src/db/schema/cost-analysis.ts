import { sqliteTable, text, real, index } from 'drizzle-orm/sqlite-core'
import { organization } from './organization'
import { user } from './user'

export const costAnalysis = sqliteTable('cost_analysis', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id),
  jobNumber: text('job_number'),
  specNumber: text('spec_number'),
  customerName: text('customer_name'),
  preCostPerM: real('pre_cost_per_m'),
  postCostPerM: real('post_cost_per_m'),
  varianceAmount: real('variance_amount'),
  variancePct: real('variance_pct'),
  rootCauseCategory: text('root_cause_category'),
  marginPct: real('margin_pct'),
  verdict: text('verdict'),
  report: text('report'),
  chatHistory: text('chat_history'),
  status: text('status').notNull().default('in_progress'),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at'),
}, (table) => ({
  orgIdx: index('cost_analysis_org_idx').on(table.organizationId),
  jobIdx: index('cost_analysis_job_idx').on(table.jobNumber),
  specIdx: index('cost_analysis_spec_idx').on(table.specNumber),
  statusIdx: index('cost_analysis_status_idx').on(table.status),
  createdByIdx: index('cost_analysis_created_by_idx').on(table.createdByUserId),
}))

export type CostAnalysisRecord = typeof costAnalysis.$inferSelect
export type NewCostAnalysisRecord = typeof costAnalysis.$inferInsert
