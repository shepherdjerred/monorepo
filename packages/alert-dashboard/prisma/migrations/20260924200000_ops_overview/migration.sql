-- CreateTable
CREATE TABLE "OpsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generatedAtNs" BIGINT NOT NULL,
    "receivedAtNs" BIGINT NOT NULL,
    "severity" TEXT NOT NULL,
    "payload" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "ChangeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "service" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "occurredAtNs" BIGINT NOT NULL,
    "severity" TEXT NOT NULL,
    "url" TEXT,
    "receivedAtNs" BIGINT NOT NULL
);

-- CreateTable
CREATE TABLE "ViewerCursor" (
    "consumer" TEXT NOT NULL PRIMARY KEY,
    "lastSeenAtNs" BIGINT NOT NULL,
    "seenSignalIds" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "DigestRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAtNs" BIGINT NOT NULL,
    "claimedAtNs" BIGINT,
    "sentAtNs" BIGINT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "messageId" TEXT NOT NULL,
    "subject" TEXT,
    "lastError" TEXT
);

-- CreateIndex
CREATE INDEX "OpsSnapshot_generatedAtNs_idx" ON "OpsSnapshot"("generatedAtNs");

-- CreateIndex
CREATE INDEX "ChangeEvent_occurredAtNs_idx" ON "ChangeEvent"("occurredAtNs");

-- CreateIndex
CREATE INDEX "ChangeEvent_service_occurredAtNs_idx" ON "ChangeEvent"("service", "occurredAtNs");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeEvent_source_externalId_key" ON "ChangeEvent"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestRun_messageId_key" ON "DigestRun"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "DigestRun_kind_periodKey_key" ON "DigestRun"("kind", "periodKey");
