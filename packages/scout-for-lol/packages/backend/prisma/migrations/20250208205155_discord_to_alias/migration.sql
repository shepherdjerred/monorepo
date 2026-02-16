/*
  Warnings:

  - A unique constraint covering the columns `[serverId,alias]` on the table `Player` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Player_serverId_discordId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Player_serverId_alias_key" ON "Player"("serverId", "alias");
