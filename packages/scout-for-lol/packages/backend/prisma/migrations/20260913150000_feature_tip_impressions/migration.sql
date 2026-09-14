-- Feature tips: which tip an audience has already been shown, and when.
--
-- Append-only. Cooldown and "already shown" are both derived from these rows
-- rather than from stored counters, so neither can drift out of step with what
-- was actually delivered.
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

    CONSTRAINT "FeatureTipImpression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_audienceId_tipKey_key" ON "FeatureTipImpression"("serverId", "audienceId", "tipKey");
CREATE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_audienceId_shownAt_idx" ON "FeatureTipImpression"("serverId", "audienceId", "shownAt");
