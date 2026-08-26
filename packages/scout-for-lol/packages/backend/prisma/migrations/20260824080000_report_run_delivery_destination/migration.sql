ALTER TABLE "ReportRun"
ADD COLUMN "deliveryChannelId" TEXT,
ADD COLUMN "deliveryServerId" TEXT;

UPDATE "ReportRun" AS run
SET
  "deliveryChannelId" = report."channelId",
  "deliveryServerId" = report."serverId"
FROM "Report" AS report
WHERE report."id" = run."reportId";
