CREATE TABLE "ReportDeliveryChunk" (
  "reportRunId" INTEGER NOT NULL,
  "channelId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "serverId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "attachmentKey" TEXT,
  "attachmentName" TEXT,
  "attachmentDigest" TEXT,
  "nonce" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "messageId" TEXT,
  "sendStartedAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReportDeliveryChunk_pkey" PRIMARY KEY ("reportRunId", "channelId", "chunkIndex"),
  CONSTRAINT "ReportDeliveryChunk_state_check" CHECK ("state" IN ('PENDING', 'SENDING', 'DELIVERED', 'UNKNOWN')),
  CONSTRAINT "ReportDeliveryChunk_attachment_check" CHECK (
    ("attachmentKey" IS NULL AND "attachmentName" IS NULL AND "attachmentDigest" IS NULL) OR
    ("attachmentKey" IS NOT NULL AND "attachmentName" IS NOT NULL AND "attachmentDigest" IS NOT NULL)
  ),
  CONSTRAINT "ReportDeliveryChunk_run_fkey" FOREIGN KEY ("reportRunId") REFERENCES "ReportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReportDeliveryChunk_state_updatedAt_idx" ON "ReportDeliveryChunk"("state", "updatedAt");
CREATE TABLE "NotificationPresentation" (
  "intentKey" TEXT PRIMARY KEY,
  "serverId" TEXT NOT NULL,
  "clashEnabled" BOOLEAN NOT NULL,
  "guildPrematchArtifact" BOOLEAN NOT NULL DEFAULT false,
  "tipKey" TEXT,
  "tipText" TEXT,
  "messageJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPresentation_tip_check" CHECK (("tipKey" IS NULL) = ("tipText" IS NULL))
);
