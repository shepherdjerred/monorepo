CREATE TABLE "RiotAccountPreference" (
  "puuid" TEXT NOT NULL,
  "ownerDiscordId" TEXT,
  "gameName" TEXT NOT NULL,
  "tagLine" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "matchNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RiotAccountPreference_pkey" PRIMARY KEY ("puuid")
);
CREATE INDEX "RiotAccountPreference_ownerDiscordId_idx" ON "RiotAccountPreference"("ownerDiscordId");
CREATE INDEX "RiotAccountPreference_matchNotificationsEnabled_idx" ON "RiotAccountPreference"("matchNotificationsEnabled");
ALTER TABLE "RiotAccountPreference" ADD CONSTRAINT "RiotAccountPreference_ownerDiscordId_fkey" FOREIGN KEY ("ownerDiscordId") REFERENCES "User"("discordId") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "RiotOAuthLinkAttempt" (
  "stateDigest" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "sessionDigest" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3),
  "verifiedPuuid" TEXT,
  "gameName" TEXT,
  "tagLine" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RiotOAuthLinkAttempt_pkey" PRIMARY KEY ("stateDigest")
);
CREATE INDEX "RiotOAuthLinkAttempt_discordId_createdAt_idx" ON "RiotOAuthLinkAttempt"("discordId", "createdAt");
CREATE INDEX "RiotOAuthLinkAttempt_expiresAt_idx" ON "RiotOAuthLinkAttempt"("expiresAt");
ALTER TABLE "RiotOAuthLinkAttempt" ADD CONSTRAINT "RiotOAuthLinkAttempt_discordId_fkey" FOREIGN KEY ("discordId") REFERENCES "User"("discordId") ON DELETE CASCADE ON UPDATE CASCADE;
