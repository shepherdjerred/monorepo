/*
  Warnings:

  - Added the required column `createdTime` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `creatorDiscordId` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serverId` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedTime` to the `Account` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdTime` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `creatorDiscordId` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serverId` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedTime` to the `Player` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdTime` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `creatorDiscordId` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `serverId` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedTime` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT,
    "summonerId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL,
    CONSTRAINT "Account_id_fkey" FOREIGN KEY ("id") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("id", "puuid", "region", "summonerId") SELECT "id", "puuid", "region", "summonerId" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_serverId_summonerId_key" ON "Account"("serverId", "summonerId");
CREATE UNIQUE INDEX "Account_serverId_puuid_key" ON "Account"("serverId", "puuid");
CREATE TABLE "new_Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT,
    "discordId" TEXT,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL
);
INSERT INTO "new_Player" ("alias", "discordId", "id") SELECT "alias", "discordId", "id" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_serverId_discordId_key" ON "Player"("serverId", "discordId");
CREATE TABLE "new_Subscription" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "playerId" INTEGER NOT NULL,
    "channelId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL,
    CONSTRAINT "Subscription_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Subscription" ("channelId", "id", "playerId") SELECT "channelId", "id", "playerId" FROM "Subscription";
DROP TABLE "Subscription";
ALTER TABLE "new_Subscription" RENAME TO "Subscription";
CREATE UNIQUE INDEX "Subscription_serverId_playerId_channelId_key" ON "Subscription"("serverId", "playerId", "channelId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
