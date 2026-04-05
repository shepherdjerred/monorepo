-- CreateTable
CREATE TABLE "ActiveGame" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gameId" INTEGER NOT NULL,
    "trackedPuuids" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "ActiveGame_gameId_key" ON "ActiveGame"("gameId");

-- CreateIndex
CREATE INDEX "ActiveGame_expiresAt_idx" ON "ActiveGame"("expiresAt");
