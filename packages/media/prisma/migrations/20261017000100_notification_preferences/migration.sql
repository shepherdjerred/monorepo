CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "discordEnabled" BOOLEAN NOT NULL DEFAULT false,
    "upgrades" BOOLEAN NOT NULL DEFAULT false,
    "removalCompleted" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailVerification_tokenHash_key" ON "EmailVerification"("tokenHash");
CREATE INDEX "EmailVerification_userId_expiresAt_idx" ON "EmailVerification"("userId", "expiresAt");
CREATE TABLE "DiscordLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscordLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DiscordLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "MediaUser"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DiscordLink_stateHash_key" ON "DiscordLink"("stateHash");
