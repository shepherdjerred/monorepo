-- AlterColumn: migrate gameId from INT to BIGINT
-- SQLite doesn't have ALTER COLUMN, so we recreate the table

-- CreateTable (new schema)
CREATE TABLE "ActiveGame_new" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" BIGINT NOT NULL,
    "trackedPuuids" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- Copy data
INSERT INTO "ActiveGame_new" ("id", "gameId", "trackedPuuids", "detectedAt", "expiresAt", "updatedAt")
SELECT "id", "gameId", "trackedPuuids", "detectedAt", "expiresAt", "updatedAt" FROM "ActiveGame";

-- Drop old table
DROP TABLE "ActiveGame";

-- Rename new table
ALTER TABLE "ActiveGame_new" RENAME TO "ActiveGame";

-- Recreate indexes
CREATE UNIQUE INDEX "ActiveGame_gameId_key" ON "ActiveGame"("gameId");
CREATE INDEX "ActiveGame_expiresAt_idx" ON "ActiveGame"("expiresAt");
