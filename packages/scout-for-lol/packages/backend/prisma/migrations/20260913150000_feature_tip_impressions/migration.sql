-- Feature tips: which tip an audience has already been shown, and when.
--
-- Delivered rows are retained as history. A non-null claimedAt is a temporary
-- pre-send reservation, cleared after an accepted send or deleted on failure.
-- Cooldown and "already shown" are derived from these rows rather than from
-- stored counters, so neither can drift out of step with what was delivered.
--
-- The unique constraint is load-bearing, not hygiene: inserting the row IS the
-- claim on a tip, so two concurrent deliveries to the same audience race here
-- and exactly one wins. `discordId` is NOT NULL with a "" sentinel for the
-- channel audience because Postgres treats NULLs as distinct, which would
-- leave every channel-scoped row outside the constraint.
CREATE TABLE IF NOT EXISTS "FeatureTipImpression" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "audienceId" TEXT NOT NULL DEFAULT '',
    "tipKey" TEXT NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "FeatureTipImpression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_audienceId_tipKey_key" ON "FeatureTipImpression"("serverId", "audienceId", "tipKey");
CREATE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_audienceId_shownAt_idx" ON "FeatureTipImpression"("serverId", "audienceId", "shownAt");
-- Prisma cannot express a partial unique index. While claimed, one audience
-- may have only one tip of any key; confirmed rows remain append-only history.
CREATE UNIQUE INDEX IF NOT EXISTS "FeatureTipImpression_active_audience_key"
  ON "FeatureTipImpression"("serverId", "audienceId")
  WHERE "claimedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_audienceId_claimedAt_idx" ON "FeatureTipImpression"("serverId", "audienceId", "claimedAt");
