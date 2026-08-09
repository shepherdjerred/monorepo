-- Replace the three one-shot outreach markers with a delivered-message counter.
--
-- The old columns were stamped regardless of whether a DM was actually sent
-- ("mark as sent regardless"), so a guild that was skipped at its 14-day check
-- could never be asked again. `outreachStage` counts real deliveries instead.
ALTER TABLE "GuildInstall" ADD COLUMN "outreachStage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GuildInstall" ADD COLUMN "lastOutreachAt" DATETIME;
ALTER TABLE "GuildInstall" ADD COLUMN "feedbackRequestedAt" DATETIME;
ALTER TABLE "GuildInstall" ADD COLUMN "emailNudgeSentAt" DATETIME;

-- Backfill from what actually happened, not from the legacy markers: DmAuditLog
-- is the record of delivery. Counting the legacy columns instead would re-burn
-- exactly the guilds this change exists to un-burn.
UPDATE "GuildInstall"
SET "outreachStage" = (
  SELECT COUNT(*)
  FROM "DmAuditLog"
  WHERE "DmAuditLog"."guildId" = "GuildInstall"."serverId"
    AND "DmAuditLog"."kind" LIKE 'outreach%'
    AND "DmAuditLog"."deliveryStatus" = 'sent'
);

UPDATE "GuildInstall"
SET "lastOutreachAt" = (
  SELECT MAX("DmAuditLog"."createdAt")
  FROM "DmAuditLog"
  WHERE "DmAuditLog"."guildId" = "GuildInstall"."serverId"
    AND "DmAuditLog"."kind" LIKE 'outreach%'
    AND "DmAuditLog"."deliveryStatus" = 'sent'
);

-- A delivered 14-day DM was the feedback ask under the old ladder.
UPDATE "GuildInstall"
SET "feedbackRequestedAt" = (
  SELECT MAX("DmAuditLog"."createdAt")
  FROM "DmAuditLog"
  WHERE "DmAuditLog"."guildId" = "GuildInstall"."serverId"
    AND "DmAuditLog"."kind" = 'outreach_14d'
    AND "DmAuditLog"."deliveryStatus" = 'sent'
);

-- Cap at the budget so a guild that historically received more than three
-- messages is treated as exhausted rather than going negative on remaining.
UPDATE "GuildInstall" SET "outreachStage" = 3 WHERE "outreachStage" > 3;
