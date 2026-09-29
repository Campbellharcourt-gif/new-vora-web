-- Last-active-Owner backstop, part 2 (hand-written).
--
-- 0001's `user_roles_keep_last_owner` cannot see the user row once `DELETE FROM users` has
-- removed it (the ON DELETE CASCADE runs after the parent delete), so deleting the Owner's
-- account slipped past it. Found by the Phase 1 integration suite. These triggers guard the
-- user row itself: the last active Owner can be neither deleted, nor suspended/deactivated,
-- nor soft-deleted by any SQL path.
--
-- "Active Owner" = holds the owner role, status = 'active', deleted_at IS NULL.

CREATE TRIGGER `users_keep_last_owner_delete` BEFORE DELETE ON `users`
WHEN OLD.`status` = 'active' AND OLD.`deleted_at` IS NULL
  AND EXISTS (SELECT 1 FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id`
              WHERE ur.`user_id` = OLD.`id` AND r.`key` = 'owner')
  AND (SELECT COUNT(*) FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id`
       JOIN `users` u ON u.`id` = ur.`user_id`
       WHERE r.`key` = 'owner' AND u.`status` = 'active' AND u.`deleted_at` IS NULL
         AND u.`id` != OLD.`id`) = 0
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last active owner');
END;
--> statement-breakpoint
CREATE TRIGGER `users_keep_last_owner_status` BEFORE UPDATE OF `status`, `deleted_at` ON `users`
WHEN OLD.`status` = 'active' AND OLD.`deleted_at` IS NULL
  AND (NEW.`status` != 'active' OR NEW.`deleted_at` IS NOT NULL)
  AND EXISTS (SELECT 1 FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id`
              WHERE ur.`user_id` = OLD.`id` AND r.`key` = 'owner')
  AND (SELECT COUNT(*) FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id`
       JOIN `users` u ON u.`id` = ur.`user_id`
       WHERE r.`key` = 'owner' AND u.`status` = 'active' AND u.`deleted_at` IS NULL
         AND u.`id` != OLD.`id`) = 0
BEGIN
  SELECT RAISE(ABORT, 'cannot remove the last active owner');
END;
