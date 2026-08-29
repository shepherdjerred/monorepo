CREATE TABLE "BucksWeeklyLeaderboardSnapshot" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "runWeek" INTEGER NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryCount" INTEGER NOT NULL,
    "entries" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BucksWeeklyLeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BucksWeeklyLeaderboardSnapshot_serverId_runWeek_key" ON "BucksWeeklyLeaderboardSnapshot"("serverId", "runWeek");

CREATE INDEX "BucksWeeklyLeaderboardSnapshot_serverId_postedAt_idx" ON "BucksWeeklyLeaderboardSnapshot"("serverId", "postedAt");
