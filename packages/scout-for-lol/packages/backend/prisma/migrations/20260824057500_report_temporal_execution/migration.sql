ALTER TABLE "ReportRun"
ADD COLUMN "temporalWorkflowRunId" TEXT;

CREATE UNIQUE INDEX "ReportRun_temporalWorkflowRunId_key"
ON "ReportRun"("temporalWorkflowRunId");
