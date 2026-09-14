-- Feature tips: which tip an audience has already been shown, and when.
--
-- Append-only. Cooldown and "already shown" are both derived from these rows
-- rather than from stored counters, so neither can drift out of step with what
-- was actually delivered.
CREATE TABLE IF NOT EXISTS "FeatureTipImpression" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT,
    "tipKey" TEXT NOT NULL,
    "shownAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureTipImpression_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_discordId_shownAt_idx" ON "FeatureTipImpression"("serverId", "discordId", "shownAt");
CREATE INDEX IF NOT EXISTS "FeatureTipImpression_serverId_discordId_tipKey_idx" ON "FeatureTipImpression"("serverId", "discordId", "tipKey");
