-- CreateTable
CREATE TABLE "Subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playerId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    CONSTRAINT "Subscription_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT,
    "discordId" TEXT
);

-- CreateTable
CREATE TABLE "Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "summonerId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    CONSTRAINT "Account_id_fkey" FOREIGN KEY ("id") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_discordId_key" ON "Player"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_summonerId_key" ON "Account"("summonerId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_puuid_key" ON "Account"("puuid");
