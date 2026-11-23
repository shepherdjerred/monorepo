ALTER TABLE "ScoutClientReplayArtifact"
  ADD COLUMN "gameBuild" TEXT,
  ADD COLUMN "protocol" TEXT,
  ADD COLUMN "durationSeconds" DOUBLE PRECISION,
  ADD COLUMN "mapId" INTEGER,
  ADD COLUMN "gameMode" TEXT,
  ADD COLUMN "teamSizes" JSONB;

ALTER TABLE "ScoutClientReplayArtifact"
  ADD CONSTRAINT "ScoutClientReplayArtifact_metadata_complete" CHECK (
    ("gameBuild" IS NULL AND "protocol" IS NULL AND "durationSeconds" IS NULL)
    OR (
      "gameBuild" IS NOT NULL AND "protocol" IS NOT NULL AND "durationSeconds" IS NOT NULL
      AND "durationSeconds" > 0 AND "durationSeconds" <= 86400
    )
  );

CREATE TABLE "ReplayPatchObservation" (
  "platformId" TEXT NOT NULL PRIMARY KEY,
  "patch" TEXT NOT NULL,
  "gameBuild" TEXT NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "sourceSha256" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ReplayRenderPackage" (
  "manifestSha256" TEXT NOT NULL PRIMARY KEY,
  "gameBuild" TEXT NOT NULL,
  "protocol" TEXT NOT NULL,
  "manifestPath" TEXT NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "publishedSha256" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL,
  "admissionJson" JSONB NOT NULL,
  "admittedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ReplayRenderPackage_manifestPath_key" ON "ReplayRenderPackage"("manifestPath");
CREATE UNIQUE INDEX "ReplayRenderPackage_gameBuild_protocol_key" ON "ReplayRenderPackage"("gameBuild", "protocol");
