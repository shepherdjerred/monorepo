-- Retire the weekly parlay feature.
--
-- `BucksAccount.balance` is the stored balance; `BucksLedgerEntry` is the audit
-- trail that must sum to it. Deleting the weekly-parlay ledger rows outright
-- would leave every affected wallet unreconcilable, so their net effect is
-- first folded into a single `adjustment` row per account. Accounts whose
-- weekly rows net to zero need no row: `delta` is documented as never zero and
-- dropping a balanced set leaves the sum unchanged.
--
-- Order matters: insert the compensating rows before deleting the originals.
--
-- `BucksLedgerEntry.weeklyParlayBetId` is deliberately NOT dropped here. It is
-- kept for one compatibility release so a rollback to the pre-removal image
-- does not hit a missing column; a follow-up migration drops it.

INSERT INTO "BucksLedgerEntry" (
    "bucksAccountId", "delta", "balanceAfter", "kind", "matchId", "context"
)
SELECT
    l."bucksAccountId",
    SUM(l."delta")::INTEGER,
    a."balance",
    'adjustment',
    NULL,
    '{"type":"adjustment","note":"Weekly parlay retirement: net of the removed weekly_parlay_* ledger rows, so this wallet still reconciles.","actorDiscordId":"system"}'
FROM "BucksLedgerEntry" l
JOIN "BucksAccount" a ON a."id" = l."bucksAccountId"
WHERE l."kind" IN (
    'weekly_parlay_stake',
    'weekly_parlay_reserve',
    'weekly_parlay_payout',
    'weekly_parlay_refund',
    'weekly_parlay_release'
)
GROUP BY l."bucksAccountId", a."balance"
HAVING SUM(l."delta") <> 0;

DELETE FROM "BucksLedgerEntry" WHERE "kind" IN (
    'weekly_parlay_stake',
    'weekly_parlay_reserve',
    'weekly_parlay_payout',
    'weekly_parlay_refund',
    'weekly_parlay_release'
);

ALTER TABLE "BucksLedgerEntry" DROP CONSTRAINT IF EXISTS "BucksLedgerEntry_weeklyParlayBetId_fkey";

DROP TABLE IF EXISTS "BucksWeeklyParlayDelivery";
DROP TABLE IF EXISTS "BucksWeeklyParlayContribution";
DROP TABLE IF EXISTS "BucksWeeklyParlayBet";
DROP TABLE IF EXISTS "BucksWeeklyParlayMarket";
DROP TABLE IF EXISTS "BucksWeeklyParlayDefinition";
