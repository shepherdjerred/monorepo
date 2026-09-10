/**
 * The Bryan Bucks house cut.
 *
 * Bucks are integer-only. Winner fees round down so every winning 1 BB match
 * remains profitable; voluntary cancellation keeps nearest-Buck rounding.
 *
 * `HOUSE_CUT_PERCENT` is the single representation of this number. It used to
 * sit beside two magic-number implementations and five hand-typed "20%"
 * strings, and they drifted: for a day the `/bb rules` embed told players the
 * fee was 20% of *gross payout* rounded to the nearest BB while the market
 * copy said 20% of *matched profit* rounded down — two different amounts, both
 * live. Every fee, and every sentence describing one, now derives from here.
 */

export const HOUSE_CUT_PERCENT = 20;

/** Round down, so a winning 1 BB match still profits. */
function houseCutRoundedDown(amount: number): number {
  return Math.floor((amount * HOUSE_CUT_PERCENT) / 100);
}

/** Round to the nearest Buck, which is what a voluntary cancellation uses. */
function houseCutRoundedNearest(amount: number): number {
  return Math.round((amount * HOUSE_CUT_PERCENT) / 100);
}

/**
 * Charge a human winner against matched profit only. Even-money matching makes
 * matched profit equal matched stake before the fee.
 */
export function settlementHouseCut(input: {
  matchedProfit: number;
  isHouse: boolean;
}): number {
  if (input.isHouse) {
    return 0;
  }
  return houseCutRoundedDown(input.matchedProfit);
}

/** A voluntary cancellation returns the offer less the rounded fee. */
export function cancellationHouseCut(stake: number): number {
  return houseCutRoundedNearest(stake);
}
