-- AlterTable
ALTER TABLE "DigestRun" ADD COLUMN "attentionCount" INTEGER;
ALTER TABLE "DigestRun" ADD COLUMN "htmlBody" TEXT;
ALTER TABLE "DigestRun" ADD COLUMN "needsMeCount" INTEGER;
ALTER TABLE "DigestRun" ADD COLUMN "plainBody" TEXT;
ALTER TABLE "DigestRun" ADD COLUMN "reportPayload" JSONB;
ALTER TABLE "DigestRun" ADD COLUMN "severity" TEXT;
ALTER TABLE "DigestRun" ADD COLUMN "skipReason" TEXT;
ALTER TABLE "DigestRun" ADD COLUMN "summary" TEXT;

-- CreateTable
CREATE TABLE "ReportRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportType" TEXT NOT NULL,
    "scheduleId" TEXT,
    "title" TEXT NOT NULL,
    "eyebrow" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "mailboxFrom" TEXT NOT NULL,
    "mailboxTo" TEXT NOT NULL,
    "execution" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "deliveryStatus" TEXT NOT NULL,
    "skipReason" TEXT,
    "messageId" TEXT,
    "startedAtNs" BIGINT NOT NULL,
    "completedAtNs" BIGINT NOT NULL,
    "acceptedAtNs" BIGINT,
    "receivedAtNs" BIGINT NOT NULL,
    "prUrl" TEXT,
    "autoMergeEnabled" BOOLEAN,
    "workflowId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "temporalUrl" TEXT,
    "repoSha" TEXT,
    "findingCount" INTEGER NOT NULL,
    "actionableFindingCount" INTEGER NOT NULL,
    "failedCheckCount" INTEGER NOT NULL,
    "envelope" JSONB NOT NULL,
    "htmlBody" TEXT
);

-- CreateIndex
CREATE INDEX "ReportRun_completedAtNs_idx" ON "ReportRun"("completedAtNs");

-- CreateIndex
CREATE INDEX "ReportRun_scheduleId_completedAtNs_idx" ON "ReportRun"("scheduleId", "completedAtNs");

-- CreateIndex
CREATE INDEX "ReportRun_reportType_completedAtNs_idx" ON "ReportRun"("reportType", "completedAtNs");

-- CreateIndex
CREATE INDEX "ReportRun_verdict_completedAtNs_idx" ON "ReportRun"("verdict", "completedAtNs");

-- CreateIndex
CREATE INDEX "ReportRun_deliveryStatus_completedAtNs_idx" ON "ReportRun"("deliveryStatus", "completedAtNs");

-- CreateIndex
CREATE INDEX "DigestRun_createdAtNs_idx" ON "DigestRun"("createdAtNs");
