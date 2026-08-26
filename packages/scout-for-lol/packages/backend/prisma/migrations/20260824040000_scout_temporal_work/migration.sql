CREATE TABLE "ScoutTemporalWork" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScoutTemporalWork_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScoutTemporalWork_state_createdAt_idx" ON "ScoutTemporalWork"("state", "createdAt");
CREATE INDEX "ScoutTemporalWork_kind_state_idx" ON "ScoutTemporalWork"("kind", "state");
