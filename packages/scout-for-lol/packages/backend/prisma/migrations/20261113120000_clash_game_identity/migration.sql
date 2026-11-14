-- CreateTable
CREATE TABLE "ClashGameIdentity" (
    "platform" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "riotMatchId" TEXT,
    "processingMatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClashGameIdentity_pkey" PRIMARY KEY ("platform","gameId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClashGameIdentity_riotMatchId_key" ON "ClashGameIdentity"("riotMatchId");

-- CreateIndex
CREATE INDEX "ClashGameIdentity_fingerprint_startAt_idx" ON "ClashGameIdentity"("fingerprint", "startAt");

-- An alias names a different published game, never the canonical one itself.
ALTER TABLE "ClashGameIdentity" ADD CONSTRAINT "ClashGameIdentity_alias_check"
  CHECK ("riotMatchId" IS NULL OR "riotMatchId" <> "platform" || '_' || "gameId");

-- Riot's later id of a Clash game Scout already reported is admitted as an alias only.
ALTER TABLE "MatchEvidenceAdmission" DROP CONSTRAINT "MatchEvidenceAdmission_reason_check";
ALTER TABLE "MatchEvidenceAdmission" ADD CONSTRAINT "MatchEvidenceAdmission_reason_check"
  CHECK ("reason" IN ('live-completion', 'history-discovery', 'late-discovery', 'legacy-live', 'legacy-history', 'clash-alias'));

-- Exactly one id is processed: the live game's own, or its Riot alias.
ALTER TABLE "ClashGameIdentity" ADD CONSTRAINT "ClashGameIdentity_processing_check"
  CHECK ("processingMatchId" IS NULL
    OR "processingMatchId" = "platform" || '_' || "gameId"
    OR "processingMatchId" = "riotMatchId");
