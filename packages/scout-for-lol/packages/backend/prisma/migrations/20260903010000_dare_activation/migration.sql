CREATE TABLE "BucksDareV2Activation" (
    "dareId" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "snapshotJson" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BucksDareV2Activation_pkey" PRIMARY KEY ("dareId")
);

CREATE INDEX "BucksDareV2Activation_completedAt_nextAttemptAt_requestedAt_idx"
ON "BucksDareV2Activation"("completedAt", "nextAttemptAt", "requestedAt");

ALTER TABLE "BucksDareV2Activation"
ADD CONSTRAINT "BucksDareV2Activation_dareId_fkey"
FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
