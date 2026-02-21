CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`domain` text,
	`entra_tenant_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`settings` text DEFAULT '{}',
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_domain_unique` ON `organization` (`domain`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_entra_tenant_id_unique` ON `organization` (`entra_tenant_id`);--> statement-breakpoint
CREATE INDEX `org_entra_tenant_idx` ON `organization` (`entra_tenant_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entra_object_id` text,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`job_title` text,
	`password_hash` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_platform_admin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_org_entra_idx` ON `user` (`organization_id`,`entra_object_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_org_email_idx` ON `user` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `user_email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_name_unique` ON `role` (`name`);--> statement-breakpoint
CREATE TABLE `user_role` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`user_agent` text,
	`ip_address` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `session_token_idx` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_expires_idx` ON `session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `email_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`code` text NOT NULL,
	`type` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `email_verification_email_type_idx` ON `email_verification` (`email`,`type`);--> statement-breakpoint
CREATE INDEX `email_verification_expires_idx` ON `email_verification` (`expires_at`);--> statement-breakpoint
CREATE TABLE `org_invite` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_email` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_invite_token_unique` ON `org_invite` (`token`);--> statement-breakpoint
CREATE INDEX `org_invite_org_email_idx` ON `org_invite` (`organization_id`,`email`);--> statement-breakpoint
CREATE INDEX `org_invite_token_idx` ON `org_invite` (`token`);--> statement-breakpoint
CREATE TABLE `user_nav_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`module_code` text NOT NULL,
	`nav_items` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_nav_pref_idx` ON `user_nav_preferences` (`user_id`,`organization_id`,`module_code`);--> statement-breakpoint
CREATE INDEX `user_nav_pref_user_idx` ON `user_nav_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_nav_pref_org_idx` ON `user_nav_preferences` (`organization_id`);--> statement-breakpoint
CREATE TABLE `domain_alias` (
	`organization_id` text NOT NULL,
	`domain` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `domain`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `domain_alias_domain_idx` ON `domain_alias` (`domain`);--> statement-breakpoint
CREATE TABLE `module` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `module_code_unique` ON `module` (`code`);--> statement-breakpoint
CREATE INDEX `module_code_idx` ON `module` (`code`);--> statement-breakpoint
CREATE TABLE `organization_module` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`module_id` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`activated_at` text NOT NULL,
	`deactivated_at` text,
	`settings` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_module_idx` ON `organization_module` (`organization_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `org_module_org_idx` ON `organization_module` (`organization_id`);--> statement-breakpoint
CREATE INDEX `org_module_module_idx` ON `organization_module` (`module_id`);--> statement-breakpoint
CREATE TABLE `user_organization` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`joined_at` text NOT NULL,
	`invited_by_user_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_org_idx` ON `user_organization` (`user_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `user_org_user_idx` ON `user_organization` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_org_org_idx` ON `user_organization` (`organization_id`);--> statement-breakpoint
CREATE TABLE `user_organization_module` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`module_id` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`granted_at` text NOT NULL,
	`granted_by_user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `module`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_org_module_idx` ON `user_organization_module` (`user_id`,`organization_id`,`module_id`);--> statement-breakpoint
CREATE INDEX `user_org_module_user_idx` ON `user_organization_module` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_org_module_org_idx` ON `user_organization_module` (`organization_id`);--> statement-breakpoint
CREATE INDEX `user_org_module_module_idx` ON `user_organization_module` (`module_id`);--> statement-breakpoint
CREATE TABLE `erp_quote` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`quote_number` text NOT NULL,
	`customer_id` integer NOT NULL,
	`customer_name` text NOT NULL,
	`ship_to_address_id` integer,
	`shipping_method` text DEFAULT 'freight' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`created_by_user_id` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`deleted_at` text,
	`deleted_by_user_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `erp_quote_org_idx` ON `erp_quote` (`organization_id`);--> statement-breakpoint
CREATE INDEX `erp_quote_status_idx` ON `erp_quote` (`status`);--> statement-breakpoint
CREATE INDEX `erp_quote_customer_idx` ON `erp_quote` (`customer_id`);--> statement-breakpoint
CREATE INDEX `erp_quote_created_by_idx` ON `erp_quote` (`created_by_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `erp_quote_number_idx` ON `erp_quote` (`organization_id`,`quote_number`);--> statement-breakpoint
CREATE TABLE `erp_quote_line` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`description` text,
	`quantity` integer DEFAULT 5000 NOT NULL,
	`box_style` text,
	`length` real,
	`width` real,
	`depth` real,
	`board_grade_id` integer,
	`board_grade_code` text,
	`ink_coverage_percent` real DEFAULT 0,
	`is_glued` integer DEFAULT 1 NOT NULL,
	`cost_snapshot` text,
	`price_per_m` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `erp_quote`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `erp_quote_line_quote_idx` ON `erp_quote_line` (`quote_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `erp_quote_line_number_idx` ON `erp_quote_line` (`quote_id`,`line_number`);