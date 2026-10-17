-- The worker looks for events that are not processed yet; once processed they are skipped.
CREATE INDEX "notification_events_pending_idx" ON "notification_events" ("created_at", "id")
  WHERE "processed_at" IS NULL;

-- The bell counts each member's unread notifications on every page.
CREATE INDEX "notifications_unread_idx" ON "notifications" ("organization_id", "membership_id")
  WHERE "read_at" IS NULL;

ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_attempts_check"
  CHECK ("attempts" >= 0);
