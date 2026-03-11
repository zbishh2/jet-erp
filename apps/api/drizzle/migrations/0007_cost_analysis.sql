CREATE TABLE IF NOT EXISTS `cost_analysis` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organization`(`id`),
  `job_number` text,
  `spec_number` text,
  `customer_name` text,
  `pre_cost_per_m` real,
  `post_cost_per_m` real,
  `variance_amount` real,
  `variance_pct` real,
  `root_cause_category` text,
  `margin_pct` real,
  `verdict` text,
  `report` text,
  `chat_history` text,
  `status` text NOT NULL DEFAULT 'in_progress',
  `created_by_user_id` text NOT NULL REFERENCES `user`(`id`),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `deleted_at` text
);

CREATE INDEX IF NOT EXISTS `cost_analysis_org_idx` ON `cost_analysis` (`organization_id`);
CREATE INDEX IF NOT EXISTS `cost_analysis_job_idx` ON `cost_analysis` (`job_number`);
CREATE INDEX IF NOT EXISTS `cost_analysis_spec_idx` ON `cost_analysis` (`spec_number`);
CREATE INDEX IF NOT EXISTS `cost_analysis_status_idx` ON `cost_analysis` (`status`);
CREATE INDEX IF NOT EXISTS `cost_analysis_created_by_idx` ON `cost_analysis` (`created_by_user_id`);
