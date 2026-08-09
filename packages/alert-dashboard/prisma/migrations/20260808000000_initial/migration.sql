CREATE TABLE "AlertOccurrence" (
    "id" TEXT NOT NULL,
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
    "annotations" JSONB NOT NULL,
    CONSTRAINT "AlertOccurrence_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAtNs" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "detail" JSONB,
    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "receivedAtNs" BIGINT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "receiver" TEXT NOT NULL,
    "notificationReason" TEXT,
    "payloadHash" TEXT NOT NULL,
    "occurrenceIds" JSONB NOT NULL,
    "rawPayload" JSONB,
    "rawExpiresAtNs" BIGINT NOT NULL,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SnapshotRun" (
    "id" TEXT NOT NULL,
    "startedAtNs" BIGINT NOT NULL,
    "completedAtNs" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "activeCount" INTEGER NOT NULL,
    "openedCount" INTEGER NOT NULL,
    "resolvedCount" INTEGER NOT NULL,
    "error" TEXT,
    CONSTRAINT "SnapshotRun_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "createdAtNs" BIGINT NOT NULL,
    "nextAttemptAtNs" BIGINT NOT NULL,
    "sentAtNs" BIGINT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "messageId" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "occurrenceIds" JSONB NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "lastError" TEXT,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AlertOccurrence_source_fingerprint_startedAtNs_key" ON "AlertOccurrence"("source", "fingerprint", "startedAtNs");
CREATE INDEX "AlertOccurrence_lifecycleState_openedAtNs_idx" ON "AlertOccurrence"("lifecycleState", "openedAtNs");
CREATE INDEX "AlertOccurrence_resolvedAtNs_idx" ON "AlertOccurrence"("resolvedAtNs");
CREATE INDEX "AlertOccurrence_severity_lifecycleState_idx" ON "AlertOccurrence"("severity", "lifecycleState");
CREATE INDEX "AlertOccurrence_namespace_idx" ON "AlertOccurrence"("namespace");
CREATE INDEX "AlertOccurrence_alertname_idx" ON "AlertOccurrence"("alertname");
CREATE INDEX "AlertOccurrence_fingerprint_idx" ON "AlertOccurrence"("fingerprint");
CREATE INDEX "AlertOccurrence_labels_gin_idx" ON "AlertOccurrence" USING GIN ("labels");
CREATE INDEX "AlertEvent_occurredAtNs_type_idx" ON "AlertEvent"("occurredAtNs", "type");
CREATE INDEX "AlertEvent_occurrenceId_occurredAtNs_idx" ON "AlertEvent"("occurrenceId", "occurredAtNs");
CREATE INDEX "WebhookDelivery_receivedAtNs_idx" ON "WebhookDelivery"("receivedAtNs");
CREATE INDEX "WebhookDelivery_groupKey_idx" ON "WebhookDelivery"("groupKey");
CREATE INDEX "WebhookDelivery_rawExpiresAtNs_idx" ON "WebhookDelivery"("rawExpiresAtNs");
CREATE INDEX "WebhookDelivery_occurrenceIds_gin_idx" ON "WebhookDelivery" USING GIN ("occurrenceIds");
CREATE INDEX "SnapshotRun_completedAtNs_idx" ON "SnapshotRun"("completedAtNs");
CREATE UNIQUE INDEX "EmailOutbox_messageId_key" ON "EmailOutbox"("messageId");
CREATE INDEX "EmailOutbox_sentAtNs_nextAttemptAtNs_idx" ON "EmailOutbox"("sentAtNs", "nextAttemptAtNs");
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "AlertOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
