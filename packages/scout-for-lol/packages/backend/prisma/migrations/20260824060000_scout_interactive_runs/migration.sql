CREATE TABLE "ScoutInteractiveRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "guildId" TEXT,
    "conversationId" TEXT,
    "quotaExempt" BOOLEAN NOT NULL DEFAULT false,
    "payload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "providerAttemptAt" TIMESTAMP(3),
    "stopRequestedAt" TIMESTAMP(3),
    "partialOutput" TEXT,
    "trace" TEXT,
    "resultMessageId" TEXT,
    "outcome" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScoutInteractiveRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScoutInteractiveRun_kind_ownerId_createdAt_idx" ON "ScoutInteractiveRun"("kind", "ownerId", "createdAt");
CREATE INDEX "ScoutInteractiveRun_kind_guildId_createdAt_idx" ON "ScoutInteractiveRun"("kind", "guildId", "createdAt");
CREATE INDEX "ScoutInteractiveRun_state_createdAt_idx" ON "ScoutInteractiveRun"("state", "createdAt");
CREATE INDEX "ScoutInteractiveRun_conversationId_state_idx" ON "ScoutInteractiveRun"("conversationId", "state");
