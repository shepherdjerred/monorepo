CREATE TABLE "MatchMvpTallyRefresh" (
    "matchId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "desiredRevision" INTEGER NOT NULL DEFAULT 0,
    "appliedRevision" INTEGER NOT NULL DEFAULT 0,
    "pending" BOOLEAN NOT NULL DEFAULT true,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MatchMvpTallyRefresh_pkey" PRIMARY KEY ("matchId", "serverId")
);

CREATE INDEX "MatchMvpTallyRefresh_pending_nextAttemptAt_createdAt_idx"
    ON "MatchMvpTallyRefresh"("pending", "nextAttemptAt", "createdAt");
