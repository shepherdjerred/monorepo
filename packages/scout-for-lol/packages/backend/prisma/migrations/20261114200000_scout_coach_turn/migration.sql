-- One audit row per Scout Desktop turn that carried a game context.
-- CreateTable
CREATE TABLE "ScoutCoachTurn" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "questionMessageId" TEXT NOT NULL,
    "initiation" TEXT NOT NULL,
    "sectionsPresent" TEXT[],
    "sectionsAccepted" TEXT[],
    "coachEnabled" BOOLEAN NOT NULL,
    "liveAnswersEnabled" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoutCoachTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoutCoachTurn_runId_key" ON "ScoutCoachTurn"("runId");

-- CreateIndex
CREATE INDEX "ScoutCoachTurn_ownerId_createdAt_idx" ON "ScoutCoachTurn"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutCoachTurn_deviceId_createdAt_idx" ON "ScoutCoachTurn"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoutCoachTurn_conversationId_idx" ON "ScoutCoachTurn"("conversationId");

-- AddForeignKey
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ScoutClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit is only as good as its vocabulary: an initiation or a section the
-- coach policy does not name is a writer bug, refused here rather than stored.
ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_initiation_check"
  CHECK ("initiation" IN ('player_typed', 'app_initiated'));

ALTER TABLE "ScoutCoachTurn" ADD CONSTRAINT "ScoutCoachTurn_sections_check"
  CHECK (
    "sectionsPresent" <@ ARRAY['champSelect', 'pregame', 'live', 'postgame']::TEXT[]
    AND "sectionsAccepted" <@ "sectionsPresent"
  );

