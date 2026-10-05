CREATE TABLE `engagement_services` (
	`engagement_id` text NOT NULL,
	`service_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`engagement_id`, `service_id`),
	FOREIGN KEY (`engagement_id`) REFERENCES `engagements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `engagement_services_service_idx` ON `engagement_services` (`service_id`);