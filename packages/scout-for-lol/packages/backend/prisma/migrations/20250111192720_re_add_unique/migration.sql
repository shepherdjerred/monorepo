/*
  Warnings:

  - A unique constraint covering the columns `[serverId,summonerId]` on the table `Account` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[serverId,puuid]` on the table `Account` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[serverId,discordId]` on the table `Player` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[serverId,playerId,channelId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Account_serverId_summonerId_key" ON "Account"("serverId", "summonerId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_serverId_puuid_key" ON "Account"("serverId", "puuid");

-- CreateIndex
CREATE UNIQUE INDEX "Player_serverId_discordId_key" ON "Player"("serverId", "discordId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_serverId_playerId_channelId_key" ON "Subscription"("serverId", "playerId", "channelId");
