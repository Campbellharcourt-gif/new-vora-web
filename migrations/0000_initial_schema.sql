CREATE TABLE `ai_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`user_id` text,
	`visitor_hash` text,
	`status` text DEFAULT 'active' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	`retention_until` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_conversations_channel_ck" CHECK("ai_conversations"."channel" in ('public', 'admin')),
	CONSTRAINT "ai_conversations_status_ck" CHECK("ai_conversations"."status" in ('active', 'closed', 'flagged'))
);
--> statement-breakpoint
CREATE INDEX `ai_conversations_user_idx` ON `ai_conversations` (`user_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `ai_conversations_retention_idx` ON `ai_conversations` (`retention_until`);--> statement-breakpoint
CREATE TABLE `ai_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tokens_in` integer,
	`tokens_out` integer,
	`flagged` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ai_messages_role_ck" CHECK("ai_messages"."role" in ('user', 'assistant')),
	CONSTRAINT "ai_messages_flagged_ck" CHECK("ai_messages"."flagged" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `ai_messages_conversation_idx` ON `ai_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_prompts_active_ck" CHECK("ai_prompts"."is_active" in (0, 1)),
	CONSTRAINT "ai_prompts_len_ck" CHECK(length("ai_prompts"."content") between 1 and 20000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_prompts_key_version_uq` ON `ai_prompts` (`key`,`version`);--> statement-breakpoint
CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text,
	`user_id` text,
	`channel` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`latency_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_micro_usd` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "ai_usage_channel_ck" CHECK("ai_usage"."channel" in ('public', 'admin')),
	CONSTRAINT "ai_usage_status_ck" CHECK("ai_usage"."status" in ('ok', 'error', 'timeout', 'rate_limited', 'blocked', 'malformed', 'disabled'))
);
--> statement-breakpoint
CREATE INDEX `ai_usage_created_idx` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_user_idx` ON `ai_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `client_org_members` (
	`org_id` text NOT NULL,
	`user_id` text NOT NULL,
	`org_role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`org_id`, `user_id`),
	FOREIGN KEY (`org_id`) REFERENCES `client_orgs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "client_org_members_role_ck" CHECK("client_org_members"."org_role" in ('owner', 'member', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX `client_org_members_user_idx` ON `client_org_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `client_orgs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`website_url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "client_orgs_status_ck" CHECK("client_orgs"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_orgs_slug_uq` ON `client_orgs` (`slug`);--> statement-breakpoint
CREATE TABLE `deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`due_date` text,
	`media_id` text,
	`approved_at` integer,
	`approved_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "deliverables_status_ck" CHECK("deliverables"."status" in ('pending', 'in_review', 'approved', 'changes_requested'))
);
--> statement-breakpoint
CREATE INDEX `deliverables_engagement_idx` ON `deliverables` (`engagement_id`);--> statement-breakpoint
CREATE TABLE `engagement_files` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`media_id` text NOT NULL,
	`visibility` text DEFAULT 'internal' NOT NULL,
	`label` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "engagement_files_visibility_ck" CHECK("engagement_files"."visibility" in ('client', 'internal'))
);
--> statement-breakpoint
CREATE INDEX `engagement_files_engagement_idx` ON `engagement_files` (`engagement_id`,`visibility`);--> statement-breakpoint
CREATE TABLE `engagement_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`author_id` text,
	`body` text NOT NULL,
	`visibility` text DEFAULT 'client' NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "engagement_messages_visibility_ck" CHECK("engagement_messages"."visibility" in ('client', 'internal')),
	CONSTRAINT "engagement_messages_len_ck" CHECK(length("engagement_messages"."body") between 1 and 10000)
);
--> statement-breakpoint
CREATE INDEX `engagement_messages_engagement_idx` ON `engagement_messages` (`engagement_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `engagement_staff` (
	`engagement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`engagement_id`, `user_id`),
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `engagement_staff_user_idx` ON `engagement_staff` (`user_id`);--> statement-breakpoint
CREATE TABLE `engagements` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'planning' NOT NULL,
	`summary` text,
	`start_date` text,
	`target_date` text,
	`public_project_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `client_orgs`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`public_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "engagements_status_ck" CHECK("engagements"."status" in ('planning', 'in_progress', 'review', 'delivered', 'on_hold', 'closed')),
	CONSTRAINT "engagements_start_ck" CHECK("engagements"."start_date" is null or "engagements"."start_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "engagements_target_ck" CHECK("engagements"."target_date" is null or "engagements"."target_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `engagements_org_idx` ON `engagements` (`org_id`,`status`);--> statement-breakpoint
CREATE TABLE `member_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`avatar_media_id` text,
	`preferences` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`avatar_media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "member_profiles_prefs_ck" CHECK("member_profiles"."preferences" is null or json_valid("member_profiles"."preferences"))
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`engagement_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`due_date` text,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "milestones_status_ck" CHECK("milestones"."status" in ('upcoming', 'in_progress', 'done', 'blocked'))
);
--> statement-breakpoint
CREATE INDEX `milestones_engagement_idx` ON `milestones` (`engagement_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `content_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`snapshot` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`note` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "content_versions_entity_ck" CHECK("content_versions"."entity_type" in ('project', 'service', 'page', 'partner', 'job_role')),
	CONSTRAINT "content_versions_kind_ck" CHECK("content_versions"."kind" in ('draft', 'published', 'restored')),
	CONSTRAINT "content_versions_snapshot_ck" CHECK("content_versions"."snapshot" is null or json_valid("content_versions"."snapshot")),
	CONSTRAINT "content_versions_version_ck" CHECK("content_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_versions_entity_version_uq` ON `content_versions` (`entity_type`,`entity_id`,`version`);--> statement-breakpoint
CREATE INDEX `content_versions_entity_idx` ON `content_versions` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `job_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`department` text,
	`employment_type` text,
	`location_type` text,
	`location_text` text,
	`summary` text,
	`body` text NOT NULL,
	`application_mode` text DEFAULT 'form' NOT NULL,
	`external_url` text,
	`opens_at` integer,
	`closes_at` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published_version_id` text,
	`published_at` integer,
	`has_unpublished_changes` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "job_roles_status_ck" CHECK("job_roles"."status" in ('draft', 'open', 'closed', 'archived')),
	CONSTRAINT "job_roles_slug_ck" CHECK("job_roles"."slug" glob '[a-z0-9]*' and "job_roles"."slug" not glob '*[^a-z0-9-]*' and length("job_roles"."slug") between 1 and 80),
	CONSTRAINT "job_roles_body_ck" CHECK("job_roles"."body" is null or json_valid("job_roles"."body")),
	CONSTRAINT "job_roles_employment_ck" CHECK("job_roles"."employment_type" is null or "job_roles"."employment_type" in ('full_time', 'part_time', 'contract', 'freelance', 'internship')),
	CONSTRAINT "job_roles_location_ck" CHECK("job_roles"."location_type" is null or "job_roles"."location_type" in ('remote', 'hybrid', 'onsite')),
	CONSTRAINT "job_roles_mode_ck" CHECK("job_roles"."application_mode" in ('form', 'email', 'external')),
	CONSTRAINT "job_roles_open_has_version_ck" CHECK("job_roles"."status" != 'open' or "job_roles"."published_version_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_roles_slug_uq` ON `job_roles` (`slug`);--> statement-breakpoint
CREATE INDEX `job_roles_status_idx` ON `job_roles` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`intro` text,
	`body` text NOT NULL,
	`seo_title` text,
	`seo_description` text,
	`published_version_id` text,
	`published_at` integer,
	`has_unpublished_changes` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pages_status_ck" CHECK("pages"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "pages_key_ck" CHECK("pages"."key" glob '[a-z0-9]*' and "pages"."key" not glob '*[^a-z0-9-]*' and length("pages"."key") between 1 and 80),
	CONSTRAINT "pages_body_ck" CHECK("pages"."body" is null or json_valid("pages"."body")),
	CONSTRAINT "pages_published_has_version_ck" CHECK("pages"."status" != 'published' or "pages"."published_version_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_key_uq` ON `pages` (`key`);--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`name` text NOT NULL,
	`relationship` text NOT NULL,
	`description` text,
	`statement` text,
	`url` text,
	`logo_media_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published_version_id` text,
	`published_at` integer,
	`has_unpublished_changes` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`logo_media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "partners_status_ck" CHECK("partners"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "partners_slug_ck" CHECK("partners"."slug" glob '[a-z0-9]*' and "partners"."slug" not glob '*[^a-z0-9-]*' and length("partners"."slug") between 1 and 80),
	CONSTRAINT "partners_url_ck" CHECK("partners"."url" is null or "partners"."url" like 'https://%'),
	CONSTRAINT "partners_published_has_version_ck" CHECK("partners"."status" != 'published' or "partners"."published_version_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partners_slug_uq` ON `partners` (`slug`);--> statement-breakpoint
CREATE TABLE `preview_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`version_id` text,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `content_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "preview_tokens_entity_ck" CHECK("preview_tokens"."entity_type" in ('project', 'service', 'page', 'partner', 'job_role'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preview_tokens_hash_uq` ON `preview_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `preview_tokens_entity_idx` ON `preview_tokens` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `project_media` (
	`project_id` text NOT NULL,
	`media_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`caption` text,
	`alt_override` text,
	`layout` text DEFAULT 'inline' NOT NULL,
	PRIMARY KEY(`project_id`, `media_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_media_layout_ck" CHECK("project_media"."layout" in ('inline', 'wide', 'full'))
);
--> statement-breakpoint
CREATE TABLE `project_services` (
	`project_id` text NOT NULL,
	`service_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `service_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_services_service_idx` ON `project_services` (`service_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`summary` text,
	`body` text NOT NULL,
	`year` integer,
	`client_name` text,
	`client_org_id` text,
	`credits` text NOT NULL,
	`external_url` text,
	`cover_media_id` text,
	`seo_title` text,
	`seo_description` text,
	`og_media_id` text,
	`is_featured` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published_version_id` text,
	`published_at` integer,
	`has_unpublished_changes` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`cover_media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`og_media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_status_ck" CHECK("projects"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "projects_slug_ck" CHECK("projects"."slug" glob '[a-z0-9]*' and "projects"."slug" not glob '*[^a-z0-9-]*' and length("projects"."slug") between 1 and 80),
	CONSTRAINT "projects_year_ck" CHECK("projects"."year" is null or "projects"."year" between 1990 and 2100),
	CONSTRAINT "projects_body_ck" CHECK("projects"."body" is null or json_valid("projects"."body")),
	CONSTRAINT "projects_credits_ck" CHECK("projects"."credits" is null or json_valid("projects"."credits")),
	CONSTRAINT "projects_featured_ck" CHECK("projects"."is_featured" in (0, 1)),
	CONSTRAINT "projects_published_has_version_ck" CHECK("projects"."status" != 'published' or "projects"."published_version_id" is not null),
	CONSTRAINT "projects_external_url_ck" CHECK("projects"."external_url" is null or "projects"."external_url" like 'https://%' or "projects"."external_url" like 'http://%')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_uq` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `projects_status_order_idx` ON `projects` (`status`,`sort_order`);--> statement-breakpoint
CREATE INDEX `projects_featured_idx` ON `projects` (`is_featured`,`status`);--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`body` text NOT NULL,
	`delivery_model` text NOT NULL,
	`partner_id` text,
	`seo_title` text,
	`seo_description` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`published_version_id` text,
	`published_at` integer,
	`has_unpublished_changes` integer DEFAULT true NOT NULL,
	`created_by` text,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "services_status_ck" CHECK("services"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "services_slug_ck" CHECK("services"."slug" glob '[a-z0-9]*' and "services"."slug" not glob '*[^a-z0-9-]*' and length("services"."slug") between 1 and 80),
	CONSTRAINT "services_delivery_ck" CHECK("services"."delivery_model" in ('vora', 'partner', 'joint')),
	CONSTRAINT "services_body_ck" CHECK("services"."body" is null or json_valid("services"."body")),
	CONSTRAINT "services_partner_model_ck" CHECK("services"."delivery_model" = 'vora' or "services"."partner_id" is not null),
	CONSTRAINT "services_published_has_version_ck" CHECK("services"."status" != 'published' or "services"."published_version_id" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `services_slug_uq` ON `services` (`slug`);--> statement-breakpoint
CREATE INDEX `services_status_order_idx` ON `services` (`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `slug_redirects` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`from_slug` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "slug_redirects_entity_ck" CHECK("slug_redirects"."entity_type" in ('project', 'service', 'page', 'partner', 'job_role'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slug_redirects_from_uq` ON `slug_redirects` (`entity_type`,`from_slug`);--> statement-breakpoint
CREATE TABLE `application_events` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`body` text,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "application_events_type_ck" CHECK("application_events"."type" in ('received', 'status_change', 'note', 'email')),
	CONSTRAINT "application_events_body_ck" CHECK("application_events"."body" is null or length("application_events"."body") <= 5000),
	CONSTRAINT "application_events_status_ck" CHECK("application_events"."to_status" is null or "application_events"."to_status" in ('received', 'reviewing', 'interviewing', 'offer', 'hired', 'declined', 'withdrawn', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `application_events_app_idx` ON `application_events` (`application_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`job_role_id` text,
	`submission_key` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`portfolio_url` text,
	`message` text NOT NULL,
	`cv_media_id` text,
	`status` text DEFAULT 'received' NOT NULL,
	`consent_at` integer NOT NULL,
	`ip_hash` text,
	`retention_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`job_role_id`) REFERENCES `job_roles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cv_media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "applications_status_ck" CHECK("applications"."status" in ('received', 'reviewing', 'interviewing', 'offer', 'hired', 'declined', 'withdrawn', 'archived')),
	CONSTRAINT "applications_email_lower_ck" CHECK("applications"."email" = lower("applications"."email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_submission_uq` ON `applications` (`submission_key`);--> statement-breakpoint
CREATE INDEX `applications_role_idx` ON `applications` (`job_role_id`,`status`);--> statement-breakpoint
CREATE INDEX `applications_created_idx` ON `applications` (`created_at`);--> statement-breakpoint
CREATE TABLE `enquiries` (
	`id` text PRIMARY KEY NOT NULL,
	`reference` text NOT NULL,
	`submission_key` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`company` text,
	`website_url` text,
	`project_types` text NOT NULL,
	`budget_key` text,
	`budget_label` text,
	`timeline_key` text NOT NULL,
	`timeline_label` text NOT NULL,
	`timeline_date` text,
	`message` text NOT NULL,
	`source_key` text,
	`source_label` text,
	`source_detail` text,
	`status` text DEFAULT 'received' NOT NULL,
	`assigned_to` text,
	`spam_score` integer DEFAULT 0 NOT NULL,
	`turnstile_ok` integer DEFAULT false NOT NULL,
	`consent_at` integer NOT NULL,
	`ip_hash` text,
	`country` text,
	`user_agent` text,
	`first_response_at` integer,
	`closed_at` integer,
	`retention_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "enquiries_status_ck" CHECK("enquiries"."status" in ('received', 'processing', 'contacted', 'qualified', 'won', 'lost', 'archived')),
	CONSTRAINT "enquiries_types_ck" CHECK("enquiries"."project_types" is null or json_valid("enquiries"."project_types")),
	CONSTRAINT "enquiries_spam_ck" CHECK("enquiries"."spam_score" between 0 and 100),
	CONSTRAINT "enquiries_turnstile_ck" CHECK("enquiries"."turnstile_ok" in (0, 1)),
	CONSTRAINT "enquiries_message_len_ck" CHECK(length("enquiries"."message") between 1 and 5000),
	CONSTRAINT "enquiries_email_lower_ck" CHECK("enquiries"."email" = lower("enquiries"."email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enquiries_reference_uq` ON `enquiries` (`reference`);--> statement-breakpoint
CREATE UNIQUE INDEX `enquiries_submission_uq` ON `enquiries` (`submission_key`);--> statement-breakpoint
CREATE INDEX `enquiries_status_idx` ON `enquiries` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `enquiries_email_idx` ON `enquiries` (`email`,`created_at`);--> statement-breakpoint
CREATE INDEX `enquiries_ip_idx` ON `enquiries` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `enquiry_events` (
	`id` text PRIMARY KEY NOT NULL,
	`enquiry_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`body` text,
	`actor_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`enquiry_id`) REFERENCES `enquiries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "enquiry_events_type_ck" CHECK("enquiry_events"."type" in ('received', 'status_change', 'note', 'assignment', 'email'))
);
--> statement-breakpoint
CREATE INDEX `enquiry_events_enquiry_idx` ON `enquiry_events` (`enquiry_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`actor_roles` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`summary` text NOT NULL,
	`changes` text,
	`ip_hash` text,
	`request_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "audit_logs_changes_ck" CHECK("audit_logs"."changes" is null or json_valid("audit_logs"."changes")),
	CONSTRAINT "audit_logs_roles_ck" CHECK("audit_logs"."actor_roles" is null or json_valid("audit_logs"."actor_roles"))
);
--> statement-breakpoint
CREATE INDEX `audit_logs_created_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_actor_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`template` text NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`payload` text NOT NULL,
	`sensitive` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`provider_message_id` text,
	`idempotency_key` text NOT NULL,
	`related_type` text,
	`related_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	CONSTRAINT "email_outbox_status_ck" CHECK("email_outbox"."status" in ('queued', 'sending', 'sent', 'failed', 'dead')),
	CONSTRAINT "email_outbox_payload_ck" CHECK("email_outbox"."payload" is null or json_valid("email_outbox"."payload")),
	CONSTRAINT "email_outbox_sensitive_ck" CHECK("email_outbox"."sensitive" in (0, 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_outbox_idem_uq` ON `email_outbox` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `email_outbox_status_idx` ON `email_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_related_idx` ON `email_outbox` (`related_type`,`related_id`);--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`key` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`rules` text,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "feature_flags_enabled_ck" CHECK("feature_flags"."enabled" in (0, 1)),
	CONSTRAINT "feature_flags_rules_ck" CHECK("feature_flags"."rules" is null or json_valid("feature_flags"."rules"))
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`details` text,
	CONSTRAINT "job_runs_status_ck" CHECK("job_runs"."status" in ('running', 'ok', 'failed')),
	CONSTRAINT "job_runs_details_ck" CHECK("job_runs"."details" is null or json_valid("job_runs"."details"))
);
--> statement-breakpoint
CREATE INDEX `job_runs_job_idx` ON `job_runs` (`job`,`started_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`handled_by` text,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`handled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "privacy_requests_type_ck" CHECK("privacy_requests"."type" in ('export', 'delete')),
	CONSTRAINT "privacy_requests_status_ck" CHECK("privacy_requests"."status" in ('received', 'in_progress', 'completed', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX `privacy_requests_status_idx` ON `privacy_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `security_event_acks` (
	`event_id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `security_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`user_id` text,
	`ip_hash` text,
	`country` text,
	`user_agent` text,
	`details` text,
	`request_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "security_events_severity_ck" CHECK("security_events"."severity" in ('info', 'low', 'medium', 'high', 'critical')),
	CONSTRAINT "security_events_details_ck" CHECK("security_events"."details" is null or json_valid("security_events"."details"))
);
--> statement-breakpoint
CREATE INDEX `security_events_created_idx` ON `security_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `security_events_user_idx` ON `security_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `security_events_severity_idx` ON `security_events` (`severity`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "site_settings_value_ck" CHECK("site_settings"."value" is null or json_valid("site_settings"."value"))
);
--> statement-breakpoint
CREATE TABLE `social_links` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`handle` text,
	`placements` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_visible` integer DEFAULT true NOT NULL,
	`updated_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "social_links_platform_ck" CHECK("social_links"."platform" in ('x', 'discord', 'instagram', 'linkedin', 'youtube', 'tiktok', 'github', 'behance', 'dribbble', 'vimeo', 'threads', 'other')),
	CONSTRAINT "social_links_url_ck" CHECK("social_links"."url" like 'https://%'),
	CONSTRAINT "social_links_visible_ck" CHECK("social_links"."is_visible" in (0, 1)),
	CONSTRAINT "social_links_placements_ck" CHECK("social_links"."placements" is null or json_valid("social_links"."placements"))
);
--> statement-breakpoint
CREATE INDEX `social_links_order_idx` ON `social_links` (`is_visible`,`sort_order`);--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`token_hash` text NOT NULL,
	`payload` text,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "auth_tokens_type_ck" CHECK("auth_tokens"."type" in ('password_reset', 'email_verify', 'email_change')),
	CONSTRAINT "auth_tokens_payload_ck" CHECK("auth_tokens"."payload" is null or json_valid("auth_tokens"."payload"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_tokens_hash_uq` ON `auth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role_keys` text NOT NULL,
	`client_org_id` text,
	`invited_by` text,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_user_id` text,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitations_role_keys_ck" CHECK("invitations"."role_keys" is null or json_valid("invitations"."role_keys")),
	CONSTRAINT "invitations_email_lower_ck" CHECK("invitations"."email" = lower("invitations"."email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_uq` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email_hmac` text,
	`outcome` text NOT NULL,
	`risk_score` integer DEFAULT 0 NOT NULL,
	`risk_reasons` text,
	`ip_hash` text,
	`ip_prefix` text,
	`country` text,
	`city` text,
	`asn` integer,
	`user_agent` text,
	`device_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "login_attempts_outcome_ck" CHECK("login_attempts"."outcome" in ('success', 'bad_credentials', 'locked', 'suspended', 'mfa_passed', 'mfa_failed', 'recovery_used', 'rate_limited', 'challenge_failed')),
	CONSTRAINT "login_attempts_risk_ck" CHECK("login_attempts"."risk_score" between 0 and 100),
	CONSTRAINT "login_attempts_reasons_ck" CHECK("login_attempts"."risk_reasons" is null or json_valid("login_attempts"."risk_reasons"))
);
--> statement-breakpoint
CREATE INDEX `login_attempts_user_idx` ON `login_attempts` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_email_idx` ON `login_attempts` (`email_hmac`,`created_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_ip_idx` ON `login_attempts` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `mfa_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`factor_id` text,
	`purpose` text NOT NULL,
	`code_hmac` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	`ip_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`factor_id`) REFERENCES `mfa_factors`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mfa_challenges_purpose_ck" CHECK("mfa_challenges"."purpose" in ('login', 'step_up', 'verify_factor')),
	CONSTRAINT "mfa_challenges_attempts_ck" CHECK("mfa_challenges"."attempts" >= 0 and "mfa_challenges"."max_attempts" between 1 and 10)
);
--> statement-breakpoint
CREATE INDEX `mfa_challenges_session_idx` ON `mfa_challenges` (`session_id`);--> statement-breakpoint
CREATE INDEX `mfa_challenges_user_idx` ON `mfa_challenges` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `mfa_factors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`label` text NOT NULL,
	`secret_enc` text,
	`phone_enc` text,
	`verified_at` integer,
	`last_used_at` integer,
	`disabled_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mfa_factors_type_ck" CHECK("mfa_factors"."type" in ('email_otp', 'totp', 'sms', 'webauthn'))
);
--> statement-breakpoint
CREATE INDEX `mfa_factors_user_idx` ON `mfa_factors` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`key` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`code_hmac` text NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_codes_user_code_uq` ON `recovery_codes` (`user_id`,`code_hmac`);--> statement-breakpoint
CREATE INDEX `recovery_codes_user_idx` ON `recovery_codes` (`user_id`,`used_at`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` text NOT NULL,
	`permission_key` text NOT NULL,
	PRIMARY KEY(`role_id`, `permission_key`),
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_key`) REFERENCES `permissions`(`key`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `role_permissions_perm_idx` ON `role_permissions` (`permission_key`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rank` integer NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`is_privileged` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "roles_rank_ck" CHECK("roles"."rank" between 0 and 100),
	CONSTRAINT "roles_is_system_ck" CHECK("roles"."is_system" in (0, 1)),
	CONSTRAINT "roles_is_privileged_ck" CHECK("roles"."is_privileged" in (0, 1)),
	CONSTRAINT "roles_key_ck" CHECK("roles"."key" glob '[a-z]*' and length("roles"."key") <= 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_uq` ON `roles` (`key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`auth_level` text NOT NULL,
	`auth_method` text NOT NULL,
	`mfa_verified_at` integer,
	`elevated_until` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_hash` text,
	`ip_prefix` text,
	`country` text,
	`city` text,
	`asn` integer,
	`user_agent` text,
	`device_hash` text,
	`revoked_at` integer,
	`revoked_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_auth_level_ck" CHECK("sessions"."auth_level" in ('pending_mfa', 'full')),
	CONSTRAINT "sessions_expiry_ck" CHECK("sessions"."expires_at" > "sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role_id` text NOT NULL,
	`granted_by` text,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_verified_at` integer,
	`name` text NOT NULL,
	`password_hash` text,
	`status` text DEFAULT 'invited' NOT NULL,
	`password_changed_at` integer,
	`last_login_at` integer,
	`locked_until` integer,
	`mfa_enforced` integer DEFAULT false NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "users_status_ck" CHECK("users"."status" in ('invited', 'active', 'suspended', 'deactivated')),
	CONSTRAINT "users_mfa_enforced_ck" CHECK("users"."mfa_enforced" in (0, 1)),
	CONSTRAINT "users_email_lower_ck" CHECK("users"."email" = lower("users"."email")),
	CONSTRAINT "users_active_has_password_ck" CHECK("users"."status" != 'active' or "users"."password_hash" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`storage_key` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text NOT NULL,
	`original_name` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`checksum_sha256` text,
	`alt_text` text,
	`caption` text,
	`credit` text,
	`focal_x` real,
	`focal_y` real,
	`placeholder` text,
	`status` text NOT NULL,
	`uploaded_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "media_assets_bucket_ck" CHECK("media_assets"."bucket" in ('media', 'private')),
	CONSTRAINT "media_assets_kind_ck" CHECK("media_assets"."kind" in ('image', 'video', 'model', 'document', 'font', 'audio', 'other')),
	CONSTRAINT "media_assets_status_ck" CHECK("media_assets"."status" in ('uploading', 'ready', 'failed', 'quarantined')),
	CONSTRAINT "media_assets_size_ck" CHECK("media_assets"."size_bytes" >= 0),
	CONSTRAINT "media_assets_focal_ck" CHECK(("media_assets"."focal_x" is null or "media_assets"."focal_x" between 0 and 1) and ("media_assets"."focal_y" is null or "media_assets"."focal_y" between 0 and 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_key_uq` ON `media_assets` (`storage_key`);--> statement-breakpoint
CREATE INDEX `media_assets_kind_idx` ON `media_assets` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `media_assets_deleted_idx` ON `media_assets` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `media_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`media_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum_sha256` text,
	`replaced_by` text,
	`created_at` integer NOT NULL,
	`purge_after` integer NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replaced_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `media_revisions_media_idx` ON `media_revisions` (`media_id`);--> statement-breakpoint
CREATE INDEX `media_revisions_purge_idx` ON `media_revisions` (`purge_after`);--> statement-breakpoint
CREATE TABLE `media_usages` (
	`media_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	PRIMARY KEY(`media_id`, `entity_type`, `entity_id`, `field`),
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `media_usages_entity_idx` ON `media_usages` (`entity_type`,`entity_id`);