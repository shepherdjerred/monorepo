-- The PUUID remap table already exists in environments where
-- scripts/migrate-puuid-key.ts has run; it was created there by raw SQL before
-- the model was managed. IF NOT EXISTS adopts those tables as-is instead of
-- failing the migration, and the column types below match exactly what that
-- script created.
CREATE TABLE IF NOT EXISTS "PuuidKeyMap" (
    "oldPuuid" TEXT NOT NULL,
    "gameName" TEXT,
    "tagLine" TEXT,
    "newPuuid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "harvestedAt" TIMESTAMPTZ,
    "resolvedAt" TIMESTAMPTZ,

    CONSTRAINT "PuuidKeyMap_pkey" PRIMARY KEY ("oldPuuid")
);

CREATE INDEX IF NOT EXISTS "PuuidKeyMap_status_idx" ON "PuuidKeyMap"("status");
