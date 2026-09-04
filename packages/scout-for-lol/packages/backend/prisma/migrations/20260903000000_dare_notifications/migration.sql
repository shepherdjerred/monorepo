ALTER TABLE "BucksNotificationPreference"
ADD COLUMN "dareLifecycleDms" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "dareProgressDms" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "BotState"
ADD COLUMN "pollStartedAt" TIMESTAMP(3),
ADD COLUMN "pollCompletedAt" TIMESTAMP(3),
ADD COLUMN "evidenceWatermarkAt" TIMESTAMP(3),
ADD COLUMN "pollEvidenceComplete" BOOLEAN,
ADD COLUMN "pollFailureReason" TEXT,
ADD COLUMN "pollStatus" TEXT NOT NULL DEFAULT 'never';

CREATE TABLE "BucksDareNotificationEvent" (
  "id" TEXT NOT NULL,
  "dareId" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "actorDiscordId" TEXT,
  "matchId" TEXT,
  "payload" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BucksDareNotificationEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BucksDareNotificationEvent_dareId_fkey" FOREIGN KEY ("dareId") REFERENCES "BucksDareV2"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BucksDareNotificationDelivery" (
  "id" SERIAL NOT NULL,
  "eventId" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "deliveryState" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BucksDareNotificationDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BucksDareNotificationDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "BucksDareNotificationEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "BucksDareNotificationEvent_deduplicationKey_key" ON "BucksDareNotificationEvent"("deduplicationKey");
CREATE INDEX "BucksDareNotificationEvent_dareId_occurredAt_idx" ON "BucksDareNotificationEvent"("dareId", "occurredAt");
CREATE UNIQUE INDEX "BucksDareNotificationDelivery_eventId_discordId_key" ON "BucksDareNotificationDelivery"("eventId", "discordId");
CREATE INDEX "BucksDareNotificationDelivery_deliveryState_nextAttemptAt_createdAt_idx" ON "BucksDareNotificationDelivery"("deliveryState", "nextAttemptAt", "createdAt");
