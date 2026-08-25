-- Per-user Bryan Bucks settlement DM preferences default to the current
-- behavior so existing users continue receiving both categories.
CREATE TABLE "BucksNotificationPreference" (
    "id" SERIAL NOT NULL,
    "serverId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "ownBetSettlementDms" BOOLEAN NOT NULL DEFAULT true,
    "betsOnPlayerSettlementDms" BOOLEAN NOT NULL DEFAULT true,
    "settlementDmHintShownAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BucksNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BucksNotificationPreference_serverId_discordId_key"
ON "BucksNotificationPreference"("serverId", "discordId");
