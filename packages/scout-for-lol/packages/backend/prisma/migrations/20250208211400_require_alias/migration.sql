/*
  Warnings:

  - Made the column `alias` on table `Account` required. This step will fail if there are existing NULL values in that column.
  - Made the column `alias` on table `Player` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "summonerId" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL,
    CONSTRAINT "Account_id_fkey" FOREIGN KEY ("id") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("alias", "createdTime", "creatorDiscordId", "id", "puuid", "region", "serverId", "summonerId", "updatedTime") SELECT "alias", "createdTime", "creatorDiscordId", "id", "puuid", "region", "serverId", "summonerId", "updatedTime" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_serverId_summonerId_key" ON "Account"("serverId", "summonerId");
CREATE UNIQUE INDEX "Account_serverId_puuid_key" ON "Account"("serverId", "puuid");
CREATE TABLE "new_Player" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "discordId" TEXT,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL
);
INSERT INTO "new_Player" ("alias", "createdTime", "creatorDiscordId", "discordId", "id", "serverId", "updatedTime") SELECT "alias", "createdTime", "creatorDiscordId", "discordId", "id", "serverId", "updatedTime" FROM "Player";
DROP TABLE "Player";
ALTER TABLE "new_Player" RENAME TO "Player";
CREATE UNIQUE INDEX "Player_serverId_alias_key" ON "Player"("serverId", "alias");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
