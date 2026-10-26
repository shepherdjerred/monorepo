BEGIN;

-- Applied only after the preceding release has replaced all economic writers
-- and the final redacted database archives have passed restore verification.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "BucksBet" WHERE "betOutcome" = 'pending')
     OR EXISTS (SELECT 1 FROM "BucksParlayBet" WHERE "betOutcome" = 'pending')
     OR EXISTS (SELECT 1 FROM "BucksDare" WHERE "dareState" IN ('pending_accept', 'activating', 'active'))
     OR EXISTS (SELECT 1 FROM "ScoutTemporalWork" WHERE kind = 'parlay-generation' AND state IN ('queued', 'running')) THEN
    RAISE EXCEPTION 'Legacy economic work remains; finish the retirement cutover before dropping tables';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "BucksLedgerEntry" DROP CONSTRAINT "BucksLedgerEntry_bucksAccountId_fkey";

-- DropForeignKey
ALTER TABLE "BucksLedgerEntry" DROP CONSTRAINT "BucksLedgerEntry_betId_fkey";

-- DropForeignKey
ALTER TABLE "BucksLedgerEntry" DROP CONSTRAINT "BucksLedgerEntry_parlayBetId_fkey";

-- DropForeignKey
ALTER TABLE "BucksAnalyticsLedgerOutbox" DROP CONSTRAINT "BucksAnalyticsLedgerOutbox_ledgerEntryId_fkey";

-- DropForeignKey
ALTER TABLE "BucksBet" DROP CONSTRAINT "BucksBet_poolId_fkey";

-- DropForeignKey
ALTER TABLE "BucksBet" DROP CONSTRAINT "BucksBet_bucksAccountId_fkey";

-- DropForeignKey
ALTER TABLE "BucksOpenPosition" DROP CONSTRAINT "BucksOpenPosition_poolId_fkey";

-- DropForeignKey
ALTER TABLE "BucksOpenPosition" DROP CONSTRAINT "BucksOpenPosition_bucksAccountId_fkey";

-- DropForeignKey
ALTER TABLE "BucksOpenPosition" DROP CONSTRAINT "BucksOpenPosition_betId_fkey";

-- DropForeignKey
ALTER TABLE "BucksParlayMarket" DROP CONSTRAINT "BucksParlayMarket_definitionId_fkey";

-- DropForeignKey
ALTER TABLE "BucksParlayMarket" DROP CONSTRAINT "BucksParlayMarket_outcomePoolId_fkey";

-- DropForeignKey
ALTER TABLE "BucksParlayBet" DROP CONSTRAINT "BucksParlayBet_marketId_fkey";

-- DropForeignKey
ALTER TABLE "BucksParlayBet" DROP CONSTRAINT "BucksParlayBet_bucksAccountId_fkey";

-- DropForeignKey
ALTER TABLE "BucksDareActivation" DROP CONSTRAINT "BucksDareActivation_dareId_fkey";

-- DropForeignKey
ALTER TABLE "BucksDareRevision" DROP CONSTRAINT "BucksDareRevision_dareId_fkey";

-- DropForeignKey
ALTER TABLE "BucksDareTarget" DROP CONSTRAINT "BucksDareTarget_dareId_fkey";

-- DropForeignKey
ALTER TABLE "BucksDareContribution" DROP CONSTRAINT "BucksDareContribution_dareId_fkey";

-- DropForeignKey
ALTER TABLE "BucksDareContribution" DROP CONSTRAINT "BucksDareContribution_bucksAccountId_fkey";

-- DropForeignKey
ALTER TABLE "BucksDareEvidence" DROP CONSTRAINT "BucksDareEvidence_dareId_fkey";

-- DropTable
DROP TABLE "BucksAccount";

-- DropTable
DROP TABLE "BucksNotificationPreference";

-- DropTable
DROP TABLE "BucksAnalyticsBackfillEvent";

-- DropTable
DROP TABLE "BucksLedgerEntry";

-- DropTable
DROP TABLE "BucksAnalyticsLedgerOutbox";

-- DropTable
DROP TABLE "BucksBet";

-- DropTable
DROP TABLE "BucksOpenPosition";

-- DropTable
DROP TABLE "BucksMatchPool";

-- DropTable
DROP TABLE "BucksParlayDefinition";

-- DropTable
DROP TABLE "BucksParlayMarket";

-- DropTable
DROP TABLE "BucksParlayBet";

-- DropTable
DROP TABLE "BucksDare";

-- DropTable
DROP TABLE "BucksDareActivation";

-- DropTable
DROP TABLE "BucksDareRevision";

-- DropTable
DROP TABLE "BucksDareTarget";

-- DropTable
DROP TABLE "BucksDareContribution";

-- DropTable
DROP TABLE "BucksDareEvidence";

-- DropTable
DROP TABLE "BucksMatchEarning";

-- DropTable
DROP TABLE "BucksWeeklyLeaderboardSnapshot";

-- DropTable
DROP TABLE "BucksWeeklyPublication";

-- DropTable
DROP TABLE "MatchSettlementAnnouncement";


COMMIT;
