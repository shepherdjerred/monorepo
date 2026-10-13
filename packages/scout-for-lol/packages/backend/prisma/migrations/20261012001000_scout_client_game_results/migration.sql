CREATE TABLE "ScoutClientGameResult" (
  "observationId" TEXT PRIMARY KEY,
  "riotMatchId" TEXT NOT NULL,
  "observerPuuid" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "normalizerVersion" INTEGER NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientGameResult_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ScoutClientObservation"("observationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ScoutClientGameResult_observerPuuid_capturedAt_idx" ON "ScoutClientGameResult"("observerPuuid", "capturedAt");
CREATE INDEX "ScoutClientGameResult_riotMatchId_idx" ON "ScoutClientGameResult"("riotMatchId");
ALTER TABLE "ClashGameSighting" ADD COLUMN "resultSource" TEXT NOT NULL DEFAULT 'RIOT';
ALTER TABLE "ClashGameSighting" ADD COLUMN "resultConflict" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ScoutClientObservation"
  ADD COLUMN "recoveryVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recoveryAttemptAt" TIMESTAMP(3),
  ADD COLUMN "recoveryComplete" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "ScoutClientObservation_recoveryComplete_recoveryAttemptAt_idx" ON "ScoutClientObservation"("recoveryComplete", "recoveryAttemptAt");
CREATE TABLE "ScoutClientObservationRevalidation" (
  "id" SERIAL PRIMARY KEY,
  "observationId" TEXT NOT NULL,
  "previousReason" TEXT,
  "validatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientObservationRevalidation_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ScoutClientObservation"("observationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ScoutClientObservationRevalidation_observationId_idx" ON "ScoutClientObservationRevalidation"("observationId");
