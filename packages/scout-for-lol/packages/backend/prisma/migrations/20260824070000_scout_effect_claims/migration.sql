CREATE TABLE "ScoutEffectClaim" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CLAIMED',
    "lastError" TEXT,
    "resultId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoutEffectClaim_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "ScoutEffectClaim_kind_state_claimedAt_idx" ON "ScoutEffectClaim"("kind", "state", "claimedAt");
