/**
 * Parimutuel payout allocation.
 *
 * Pure, integer-only, and closed: it calculates gross payouts, so every Buck
 * staked into a pool comes back out of this allocator. Human two-sided pools
 * remain purely parimutuel; one-sided pools are supplied a synthetic house
 * position by settlement before reaching this function. Settlement then
 * transfers the configured cut from each human winner's gross allocation to
 * the house. The gross identity here, and the net-plus-cuts identity there,
 * are both asserted so a violation rolls the transaction back instead of
 * minting or destroying currency.
 */

export type ParimutuelBet = {
  betId: number;
  predictedTeamId: number;
  stake: number;
};

export type ParimutuelAllocation = {
  betId: number;
  /** Gross returned: the original stake plus winnings. */
  payout: number;
  /** The share of the losing pool, excluding the returned stake. */
  winnings: number;
};

export type ParimutuelResult =
  | { kind: "refund_all"; totalStake: number }
  | {
      kind: "paid";
      winnersPool: number;
      losersPool: number;
      allocations: readonly ParimutuelAllocation[];
    };

function sumStakes(bets: readonly ParimutuelBet[]): number {
  return bets.reduce((total, bet) => total + bet.stake, 0);
}

/**
 * Distribute the losing pool across the winners in proportion to stake.
 *
 * Integer division loses a remainder of at most `winners.length - 1` Bucks.
 * Dropping it would quietly destroy currency and break the conservation
 * assertion, so it is handed out one Buck at a time to the largest stakes
 * first, ties broken by `betId`. That ordering is total and depends only on
 * the inputs, so re-running settlement on the same pool produces byte-identical
 * allocations.
 */
function allocateWinnings(
  winners: readonly ParimutuelBet[],
  winnersPool: number,
  losersPool: number,
): ParimutuelAllocation[] {
  const ordered = [...winners].sort(
    (a, b) => b.stake - a.stake || a.betId - b.betId,
  );

  const floored = ordered.map((bet) => ({
    bet,
    winnings: Math.floor((bet.stake * losersPool) / winnersPool),
  }));

  const distributed = floored.reduce((total, row) => total + row.winnings, 0);
  let remainder = losersPool - distributed;

  return floored.map((row) => {
    const bonus = remainder > 0 ? 1 : 0;
    remainder -= bonus;
    const winnings = row.winnings + bonus;
    return {
      betId: row.bet.betId,
      winnings,
      payout: row.bet.stake + winnings,
    };
  });
}

export function computeParimutuelPayouts(
  bets: readonly ParimutuelBet[],
  winningTeamId: number,
): ParimutuelResult {
  const winners = bets.filter((bet) => bet.predictedTeamId === winningTeamId);
  const losers = bets.filter((bet) => bet.predictedTeamId !== winningTeamId);

  const winnersPool = sumStakes(winners);
  const losersPool = sumStakes(losers);

  // Keep this safe fallback for callers that present a legacy or invalid
  // one-sided pool without first adding the house position. Refunding is
  // numerically the same as paying each winner their stake back, but it is
  // recorded as a refund so the ledger states the reason instead of leaving a
  // reader to notice that payout happened to equal stake.
  if (winnersPool === 0 || losersPool === 0) {
    return { kind: "refund_all", totalStake: winnersPool + losersPool };
  }

  const allocations = allocateWinnings(winners, winnersPool, losersPool);

  const paidOut = allocations.reduce(
    (total, allocation) => total + allocation.payout,
    0,
  );
  const expected = winnersPool + losersPool;
  if (paidOut !== expected) {
    throw new Error(
      `Parimutuel allocation did not conserve Bucks: paid ${paidOut.toString()}, pool ${expected.toString()}`,
    );
  }

  return { kind: "paid", winnersPool, losersPool, allocations };
}
