import { BUCKS_INT32_MAX } from "@scout-for-lol/data";

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
  | { kind: "storage_overflow" }
  | {
      kind: "paid";
      winnersPool: number;
      losersPool: number;
      allocations: readonly ParimutuelAllocation[];
    };

function sumStakes(bets: readonly ParimutuelBet[]): bigint {
  return bets.reduce((total, bet) => total + BigInt(bet.stake), 0n);
}

function persistedNumber(value: bigint): number | undefined {
  return value >= 0n && value <= BigInt(BUCKS_INT32_MAX)
    ? Number(value)
    : undefined;
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
  winnersPool: bigint,
  losersPool: bigint,
): ParimutuelAllocation[] | undefined {
  const ordered = [...winners].sort(
    (a, b) => b.stake - a.stake || a.betId - b.betId,
  );

  const floored = ordered.map((bet) => ({
    bet,
    winnings: (BigInt(bet.stake) * losersPool) / winnersPool,
  }));

  const distributed = floored.reduce((total, row) => total + row.winnings, 0n);
  let remainder = losersPool - distributed;

  const allocations: ParimutuelAllocation[] = [];
  for (const row of floored) {
    const bonus = remainder > 0n ? 1n : 0n;
    remainder -= bonus;
    const winnings = row.winnings + bonus;
    const payout = BigInt(row.bet.stake) + winnings;
    const persistedWinnings = persistedNumber(winnings);
    const persistedPayout = persistedNumber(payout);
    if (persistedWinnings === undefined || persistedPayout === undefined) {
      return;
    }
    allocations.push({
      betId: row.bet.betId,
      winnings: persistedWinnings,
      payout: persistedPayout,
    });
  }
  return allocations;
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
  if (winnersPool === 0n || losersPool === 0n) {
    const totalStake = persistedNumber(winnersPool + losersPool);
    return totalStake === undefined
      ? { kind: "storage_overflow" }
      : { kind: "refund_all", totalStake };
  }

  const allocations = allocateWinnings(winners, winnersPool, losersPool);
  const persistedWinnersPool = persistedNumber(winnersPool);
  const persistedLosersPool = persistedNumber(losersPool);
  if (
    allocations === undefined ||
    persistedWinnersPool === undefined ||
    persistedLosersPool === undefined
  ) {
    return { kind: "storage_overflow" };
  }

  const paidOut = allocations.reduce(
    (total, allocation) => total + BigInt(allocation.payout),
    0n,
  );
  const expected = winnersPool + losersPool;
  if (paidOut !== expected) {
    throw new Error(
      `Parimutuel allocation did not conserve Bucks: paid ${paidOut.toString()}, pool ${expected.toString()}`,
    );
  }

  return {
    kind: "paid",
    winnersPool: persistedWinnersPool,
    losersPool: persistedLosersPool,
    allocations,
  };
}
