-- Existing competitions have never dispatched interim leaderboard posts. Keep
-- that behavior explicit while allowing new builder-created rows to opt in.
ALTER TABLE "Competition"
ADD COLUMN "scheduledUpdatesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "scheduleTimezone" TEXT NOT NULL DEFAULT 'UTC';

-- Competition interim delivery is now owned exclusively by the dedicated
-- Temporal-triggered dispatcher. Retire generic system-report rows so legacy
-- competitions cannot post while disabled or double-post while enabled.
UPDATE "Report"
SET "isEnabled" = false,
    "updatedTime" = CURRENT_TIMESTAMP
WHERE "isSystemManaged" = true
  AND "systemSource" = 'COMPETITION'
  AND "isEnabled" = true;
