CREATE TABLE "PlexHistoricalView" (
    "serverMachineId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceViewId" BIGINT NOT NULL,
    "serverAccountId" TEXT NOT NULL,
    "boundPlexAccountId" TEXT,
    "sectionId" TEXT,
    "guid" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "seriesTitle" TEXT,
    "seriesGuid" TEXT,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "viewedAt" TIMESTAMP(3) NOT NULL,
    "originallyAvailableAt" TIMESTAMP(3),
    "viewType" INTEGER,
    "viewCount" INTEGER,
    "sourceSnapshotDigest" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlexHistoricalView_pkey" PRIMARY KEY ("serverMachineId", "source", "sourceViewId")
);

CREATE INDEX "plex_historical_view_page_idx"
    ON "PlexHistoricalView" ("serverMachineId", "serverAccountId", "boundPlexAccountId", "viewedAt", "source", "sourceViewId");
