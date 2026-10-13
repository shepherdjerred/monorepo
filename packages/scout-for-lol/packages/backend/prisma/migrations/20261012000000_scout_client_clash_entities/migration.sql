CREATE TABLE "ScoutClientClashEntity" (
  "observerPuuid" TEXT NOT NULL,
  "platformId" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "tournamentId" TEXT,
  "tournamentKey" TEXT NOT NULL DEFAULT '',
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "observationId" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutClientClashEntity_pkey" PRIMARY KEY ("observerPuuid", "platformId", "resource", "entityId", "tournamentKey"),
  CONSTRAINT "ScoutClientClashEntity_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "ScoutClientObservation"("observationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ScoutClientClashEntity_platformId_tournamentId_resource_idx" ON "ScoutClientClashEntity"("platformId", "tournamentId", "resource");
CREATE INDEX "ScoutClientClashEntity_observationId_idx" ON "ScoutClientClashEntity"("observationId");
