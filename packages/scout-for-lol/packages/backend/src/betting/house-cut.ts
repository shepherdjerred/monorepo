/**
 * The Bryan Bucks house cut.
 *
 * Bucks are integer-only, so every fee is rounded to the nearest whole Buck.
 * Twenty percent is one fifth; adding two before integer division implements
 * nearest-integer rounding for every non-negative amount without floating
 * point arithmetic.
 */

export const HOUSE_CUT_PERCENT = 20;

export const HOUSE_CUT_TERMS =
  "🏦 House cut: **20%** of winning payouts, rounded to the nearest BB. Winning principal is protected. Cancelling costs **20%**, also rounded to the nearest BB.";

export const HOUSE_CUT_PLACEMENT_NOTE = "**20% house cut on winning payouts**.";

function roundedHouseCut(amount: number): number {
  return Math.floor((amount + 2) / 5);
}

/**
 * Charge a human winner against the gross payout, but never take any of the
 * stake they put up. The cap makes a correct result worth at least principal
 * even in a very lopsided parimutuel pool.
 */
export function settlementHouseCut(input: {
  grossPayout: number;
  grossWinnings: number;
  isHouse: boolean;
}): number {
  if (input.isHouse) {
    return 0;
  }
  return Math.min(roundedHouseCut(input.grossPayout), input.grossWinnings);
}

/** A voluntary cancellation returns the stake less the rounded house cut. */
export function cancellationHouseCut(stake: number): number {
  return roundedHouseCut(stake);
}
