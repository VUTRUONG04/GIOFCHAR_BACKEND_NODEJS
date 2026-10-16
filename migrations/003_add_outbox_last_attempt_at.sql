ALTER TABLE `outbox_events`
  ADD COLUMN `last_attempt_at` DATETIME NULL DEFAULT NULL AFTER `attempt_count`;
