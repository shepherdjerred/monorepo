-- Retire the weekly parlay feature.
--
-- `BucksLedgerEntry.weeklyParlayBetId` is deliberately NOT dropped here. It is
-- kept for one compatibility release so a rollback to the pre-removal image
-- does not hit a missing column; a follow-up migration drops it.

-- Refuse to run while any weekly parlay money is still in flight.
--
-- A settled market's rows describe money that already moved and are safe to
-- retire. A PENDING bet is different: its stake and house-reserve debits have
-- happened but the payout or refund has not, and dropping the tables would
-- destroy that obligation while leaving the debit in place, stranding the
-- reserved Bucks.
--
-- The pre-deploy step is to disable the feature flag and cancel every open
-- market (the weekly parlay "cancel" control action voids and refunds). This
-- guard makes that step enforced rather than remembered: the migration aborts,
-- the transaction rolls back, and nothing is lost.
DO $$
DECLARE
  pending_bets BIGINT;
  live_markets BIGINT;
BEGIN
  SELECT count(*) INTO pending_bets
    FROM "BucksWeeklyParlayBet" WHERE "betOutcome" = 'pending';
  SELECT count(*) INTO live_markets
    FROM "BucksWeeklyParlayMarket"
    WHERE "marketState" NOT IN ('settled', 'voided');
  IF pending_bets > 0 OR live_markets > 0 THEN
    RAISE EXCEPTION
      'Refusing to retire weekly parlays: % pending bet(s) and % unsettled market(s) remain. Cancel and refund them first, then re-run.',
      pending_bets, live_markets;
  END IF;
END $$;

-- Retire the weekly-parlay ledger kinds by CONVERTING each row in place.
--
-- Deleting them and appending one net `adjustment` per wallet would keep the
-- totals right but corrupt the history in two ways:
--
--   * `auditAccountLedger` walks entries by id and compares every stored
--     `balanceAfter` against the running sum of deltas. Removing a delta from
--     the middle makes every later row on that wallet report drift forever.
--   * `loadWeeklyBucksStats` windows on `createdAt`, so a freshly appended row
--     would count an account's entire historical weekly-parlay net as movement
--     in the current week.
--
-- Converting in place keeps id, createdAt, delta, and balanceAfter exactly as
-- they were, so both invariants hold and the money movements stay where they
-- happened. Only the kind and its explanation change. `matchId` is left alone:
-- nothing reads it for an adjustment row, and blanking it would discard the
-- only remaining link to the game the entry came from.
UPDATE "BucksLedgerEntry"
SET "kind" = 'adjustment',
    "context" = '{"type":"adjustment","note":"Weekly parlay retired; this entry kept its original amount, order, and timestamp.","actorDiscordId":"system"}'
WHERE "kind" IN (
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
