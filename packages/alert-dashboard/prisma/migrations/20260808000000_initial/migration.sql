-- CreateTable
CREATE TABLE "AlertOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "startedAtNs" BIGINT NOT NULL,
    "openedAtNs" BIGINT NOT NULL,
    "resolvedAtNs" BIGINT,
    "lastSeenAtNs" BIGINT NOT NULL,
    "missingSinceNs" BIGINT,
    "absentSnapshots" INTEGER NOT NULL DEFAULT 0,
    "firstNotifiedAtNs" BIGINT,
    "lifecycleState" TEXT NOT NULL,
    "suppressionState" TEXT NOT NULL,
    "resolutionSource" TEXT,
    "alertname" TEXT NOT NULL,
    "namespace" TEXT,
    "severity" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "generatorUrl" TEXT,
    "labels" JSONB NOT NULL,
    "annotations" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurrenceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAtNs" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "detail" JSONB,
    CONSTRAINT "AlertEvent_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "AlertOccurrence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receivedAtNs" BIGINT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receiver" TEXT NOT NULL,
    "notificationReason" TEXT,
    "payloadHash" TEXT NOT NULL,
    "occurrenceIds" JSONB NOT NULL,
    "rawPayload" JSONB,
    "rawExpiresAtNs" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "AlertOccurrenceLabel" (
    "occurrenceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("occurrenceId", "key"),
    CONSTRAINT "AlertOccurrenceLabel_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "AlertOccurrence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookDeliveryOccurrence" (
    "deliveryId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,

    PRIMARY KEY ("deliveryId", "occurrenceId"),
    CONSTRAINT "WebhookDeliveryOccurrence_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebhookDeliveryOccurrence_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "AlertOccurrence" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SnapshotRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAtNs" BIGINT NOT NULL,
    "completedAtNs" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "openedCount" INTEGER NOT NULL,
    "resolvedCount" INTEGER NOT NULL,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAtNs" BIGINT NOT NULL,
    "nextAttemptAtNs" BIGINT NOT NULL,
    "sentAtNs" BIGINT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "messageId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "occurrenceIds" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "lastError" TEXT
);

-- CreateIndex
CREATE INDEX "AlertOccurrence_lifecycleState_openedAtNs_idx" ON "AlertOccurrence"("lifecycleState", "openedAtNs");

-- CreateIndex
CREATE INDEX "AlertOccurrence_resolvedAtNs_idx" ON "AlertOccurrence"("resolvedAtNs");

-- CreateIndex
CREATE INDEX "AlertOccurrence_severity_lifecycleState_idx" ON "AlertOccurrence"("severity", "lifecycleState");

-- CreateIndex
CREATE INDEX "AlertOccurrence_namespace_idx" ON "AlertOccurrence"("namespace");

-- CreateIndex
CREATE INDEX "AlertOccurrence_alertname_idx" ON "AlertOccurrence"("alertname");

-- CreateIndex
CREATE INDEX "AlertOccurrence_fingerprint_idx" ON "AlertOccurrence"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "AlertOccurrence_source_fingerprint_startedAtNs_key" ON "AlertOccurrence"("source", "fingerprint", "startedAtNs");

-- CreateIndex
CREATE INDEX "AlertEvent_occurredAtNs_type_idx" ON "AlertEvent"("occurredAtNs", "type");

-- CreateIndex
CREATE INDEX "AlertEvent_occurrenceId_occurredAtNs_idx" ON "AlertEvent"("occurrenceId", "occurredAtNs");

-- CreateIndex
CREATE INDEX "WebhookDelivery_receivedAtNs_idx" ON "WebhookDelivery"("receivedAtNs");

-- CreateIndex
CREATE INDEX "WebhookDelivery_groupKey_idx" ON "WebhookDelivery"("groupKey");

-- CreateIndex
CREATE INDEX "WebhookDelivery_rawExpiresAtNs_idx" ON "WebhookDelivery"("rawExpiresAtNs");

-- CreateIndex
CREATE INDEX "AlertOccurrenceLabel_key_value_occurrenceId_idx" ON "AlertOccurrenceLabel"("key", "value", "occurrenceId");

-- CreateIndex
CREATE INDEX "WebhookDeliveryOccurrence_occurrenceId_deliveryId_idx" ON "WebhookDeliveryOccurrence"("occurrenceId", "deliveryId");

-- CreateIndex
CREATE INDEX "SnapshotRun_completedAtNs_idx" ON "SnapshotRun"("completedAtNs");

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_messageId_key" ON "EmailOutbox"("messageId");

-- CreateIndex
CREATE INDEX "EmailOutbox_sentAtNs_nextAttemptAtNs_idx" ON "EmailOutbox"("sentAtNs", "nextAttemptAtNs");
