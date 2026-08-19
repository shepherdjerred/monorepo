/**
 * The Bryan Bucks house cut.
 *
 * Bucks are integer-only. Winner fees round down so every winning 1 BB match
 * remains profitable; voluntary cancellation keeps nearest-Buck rounding.
 */

export const HOUSE_CUT_PERCENT = 20;

export const HOUSE_CUT_TERMS =
  "🎯 An outcome amount is a maximum offer; only matched BB are at risk and unmatched BB are refunded at close. The house can fill up to **5 BB per game** after human matching. 🏦 Outcome winners pay **20% of matched profit**, rounded down. Cancelling an outcome offer costs **20%**, rounded to the nearest BB; parlay cancellation is fully refunded.";

export const HOUSE_CUT_PLACEMENT_NOTE =
  "**Only matched BB are at risk; winners pay 20% of matched profit.**";

function roundedHouseCut(amount: number): number {
  return Math.floor((amount + 2) / 5);
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
  return Math.floor(input.matchedProfit / 5);
}

/** A voluntary cancellation returns the offer less the rounded fee. */
export function cancellationHouseCut(stake: number): number {
  return roundedHouseCut(stake);
}
