-- Distinguish the normal post-match award marker from League Classic's
-- pre-match participation grant. Both are exactly-once per (match, guild),
-- but only post-match markers belong to the raw Match-V5 retry worker.
ALTER TABLE "BucksMatchEarning" ADD COLUMN "phase" TEXT NOT NULL DEFAULT 'postmatch';

CREATE INDEX "BucksMatchEarning_phase_state_retryAt_idx"
ON "BucksMatchEarning"("phase", "state", "retryAt");
