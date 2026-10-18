CREATE TABLE "WatchObservationFence" (
    "mediaId" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT 'default',
    "issuedRevision" BIGINT NOT NULL DEFAULT 0,
    "settledRevision" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "WatchObservationFence_pkey" PRIMARY KEY ("mediaId", "edition"),
    CONSTRAINT "WatchObservationFence_order" CHECK (
        "settledRevision" >= 0 AND "issuedRevision" >= "settledRevision"
    ),
    CONSTRAINT "WatchObservationFence_mediaId_edition_fkey" FOREIGN KEY ("mediaId", "edition")
        REFERENCES "MediaIntent"("mediaId", "edition") ON DELETE RESTRICT ON UPDATE CASCADE
);
