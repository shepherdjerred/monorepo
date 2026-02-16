/*
  Warnings:

  - You are about to drop the column `summonerId` on the `Account` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "puuid" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "creatorDiscordId" TEXT NOT NULL,
    "createdTime" DATETIME NOT NULL,
    "updatedTime" DATETIME NOT NULL,
    CONSTRAINT "Account_id_fkey" FOREIGN KEY ("id") REFERENCES "Player" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("alias", "createdTime", "creatorDiscordId", "id", "puuid", "region", "serverId", "updatedTime") SELECT "alias", "createdTime", "creatorDiscordId", "id", "puuid", "region", "serverId", "updatedTime" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE UNIQUE INDEX "Account_serverId_puuid_key" ON "Account"("serverId", "puuid");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
