-- Integrity triggers (hand-written; drizzle-kit does not generate triggers).
--
-- audit_logs and security_events are append-only: rows can never be updated, and can only be
-- deleted once they are older than their retention period (2 years / 1 year). This protects the
-- trail against application bugs and compromised application code paths.
--
-- content_versions are immutable snapshots; published snapshots are never deleted.

CREATE TRIGGER `audit_logs_no_update` BEFORE UPDATE ON `audit_logs`
BEGIN
  SELECT RAISE(ABORT, 'audit_logs is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_logs_retention_delete` BEFORE DELETE ON `audit_logs`
WHEN OLD.`created_at` > (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 63072000000)
BEGIN
  SELECT RAISE(ABORT, 'audit_logs rows are retained for 2 years');
END;
--> statement-breakpoint
CREATE TRIGGER `security_events_no_update` BEFORE UPDATE ON `security_events`
BEGIN
  SELECT RAISE(ABORT, 'security_events is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `security_events_retention_delete` BEFORE DELETE ON `security_events`
WHEN OLD.`created_at` > (CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 31536000000)
BEGIN
  SELECT RAISE(ABORT, 'security_events rows are retained for 1 year');
END;
--> statement-breakpoint
CREATE TRIGGER `content_versions_no_update` BEFORE UPDATE ON `content_versions`
BEGIN
  SELECT RAISE(ABORT, 'content_versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `content_versions_keep_published` BEFORE DELETE ON `content_versions`
WHEN OLD.`kind` = 'published'
BEGIN
  SELECT RAISE(ABORT, 'published content versions are kept');
END;
--> statement-breakpoint
-- The service layer prevents demoting, suspending or deleting the last active Owner. This trigger
-- is the database backstop: the last active Owner's role grant cannot be removed by any SQL path
-- (including ON DELETE CASCADE when a user row is deleted).
CREATE TRIGGER `user_roles_keep_last_owner` BEFORE DELETE ON `user_roles`
WHEN OLD.`role_id` = (SELECT `id` FROM `roles` WHERE `key` = 'owner')
  AND (SELECT COUNT(*) FROM `user_roles` ur JOIN `users` u ON u.`id` = ur.`user_id`
       WHERE ur.`role_id` = OLD.`role_id` AND u.`status` = 'active' AND ur.`user_id` != OLD.`user_id`) = 0
  AND (SELECT `status` FROM `users` WHERE `id` = OLD.`user_id`) = 'active'
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last active owner');
END;
