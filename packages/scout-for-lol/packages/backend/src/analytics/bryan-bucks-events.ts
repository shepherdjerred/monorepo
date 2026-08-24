export type BucksLifecycleTransition =
  | "bucks.pool.opened"
  | "bucks.pool.closed"
  | "bucks.pool.settled"
  | "bucks.pool.voided"
  | "bucks.bet.placed"
  | "bucks.bet.topped_up"
  | "bucks.bet.rejected"
  | "bucks.bet.cancelled"
  | "bucks.bet.matched"
  | "bucks.bet.unmatched_refunded"
  | "bucks.bet.house_filled"
  | "bucks.bet.won"
  | "bucks.bet.lost"
  | "bucks.bet.refunded"
  | "bucks.parlay.published"
  | "bucks.parlay.opened"
  | "bucks.parlay.closed"
  | "bucks.parlay.settled"
  | "bucks.parlay.voided"
  | "bucks.parlay_bet.placed"
  | "bucks.parlay_bet.cancelled"
  | "bucks.parlay_bet.settled"
  | "bucks.weekly_parlay.published"
  | "bucks.weekly_parlay.opened"
  | "bucks.weekly_parlay.started"
  | "bucks.weekly_parlay.settled"
  | "bucks.weekly_parlay.voided"
  | "bucks.weekly_parlay_bet.placed"
  | "bucks.weekly_parlay_bet.topped_up"
  | "bucks.weekly_parlay_bet.cancelled"
  | "bucks.weekly_parlay_bet.settled"
  | "bucks.weekly_parlay.contribution_recorded"
  | "bucks.earning.awarded"
  | "bucks.peek_pass.purchased";

type BucksPendingOutcome = {
  stake: number;
  matchedStake: number | null;
  bucksAccount: { serverId: string };
};

type BucksPendingStake = {
  stake: number;
  bucksAccount: { serverId: string };
};

export function aggregateBucksPendingStakes(
  pendingOutcome: ReadonlyArray<BucksPendingOutcome>,
  pendingParlay: ReadonlyArray<BucksPendingStake>,
  pendingWeekly: ReadonlyArray<BucksPendingStake>,
): Map<string, number> {
  const pendingByServer = new Map<string, number>();
  for (const bet of pendingOutcome) {
    addStake(
      pendingByServer,
      bet.bucksAccount.serverId,
      bet.matchedStake ?? bet.stake,
    );
  }
  for (const bet of [...pendingParlay, ...pendingWeekly]) {
    addStake(pendingByServer, bet.bucksAccount.serverId, bet.stake);
  }
  return pendingByServer;
}

function addStake(
  pendingByServer: Map<string, number>,
  serverId: string,
  stake: number,
): void {
  pendingByServer.set(serverId, (pendingByServer.get(serverId) ?? 0) + stake);
}

export function countBucksOpenMarkets(
  pools: ReadonlyArray<{ serverId: string }>,
): Map<string, number> {
  const openMarketsByServer = new Map<string, number>();
  for (const pool of pools) {
    openMarketsByServer.set(
      pool.serverId,
      (openMarketsByServer.get(pool.serverId) ?? 0) + 1,
    );
  }
  return openMarketsByServer;
}
