ALTER TABLE "ReportRun"
ADD COLUMN "deliveryState" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
ADD COLUMN "deliveryError" TEXT,
ADD COLUMN "deliveredAt" TIMESTAMP(3);

CREATE INDEX "ReportRun_deliveryState_createdAt_idx" ON "ReportRun"("deliveryState", "createdAt");
