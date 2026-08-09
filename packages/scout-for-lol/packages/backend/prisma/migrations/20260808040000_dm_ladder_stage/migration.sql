-- Persist the ladder rung on the audit row, and make DmAuditLog the single
-- source of truth for outreach budget and ladder position.
--
-- The Nth delivered message is NOT necessarily rung N: a bounced day-3 DM
-- followed by a delivered day-14 DM would be reconstructed as rung 1, and the
-- legacy ladder could deliver `outreach_30d` without ever sending 3d/14d.
-- Deriving the rung from a delivery count therefore both mis-attributes
-- conversions and lets a former installer receive a repeat of a rung they
-- already got.
ALTER TABLE "DmAuditLog" ADD COLUMN "ladderStage" INTEGER;

-- Backfill from the recorded kind, which is the only faithful record of which
-- rung a historical message actually was.
UPDATE "DmAuditLog" SET "ladderStage" = 1 WHERE "kind" = 'outreach_3d';
UPDATE "DmAuditLog" SET "ladderStage" = 2 WHERE "kind" = 'outreach_14d';
UPDATE "DmAuditLog" SET "ladderStage" = 3 WHERE "kind" = 'outreach_30d';

CREATE INDEX "DmAuditLog_guildId_deliveryStatus_idx" ON "DmAuditLog"("guildId", "deliveryStatus");

-- The derived-state columns are gone: budget spend, ladder position, and
-- "have we asked for feedback?" are now computed from the audit rows created
-- after `installedAt`. That boundary also makes a re-install reset everything
-- for free, instead of relying on a hand-maintained list of fields to clear.
ALTER TABLE "GuildInstall" DROP COLUMN "outreachStage";
ALTER TABLE "GuildInstall" DROP COLUMN "lastLadderStage";
ALTER TABLE "GuildInstall" DROP COLUMN "feedbackRequestedAt";
ALTER TABLE "GuildInstall" DROP COLUMN "lastOutreachAt";
