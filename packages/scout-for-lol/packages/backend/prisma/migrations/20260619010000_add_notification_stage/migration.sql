-- Backed-off owner notification escalation for GuildPermissionError streaks.
-- Columns only; no data backfill. Existing mid-streak rows default to
-- notificationStage=0 / lastNotifiedAt=NULL, so they restart at the "immediate"
-- stage on their next failure (the logic anchors on lastNotifiedAt, not the
-- stale firstOccurrence).
ALTER TABLE "GuildPermissionError" ADD COLUMN "notificationStage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GuildPermissionError" ADD COLUMN "lastNotifiedAt" DATETIME;
