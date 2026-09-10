import {
  BucksAmountSchema,
  ZERO_BUCKS,
  type BucksAmount,
  type BucksStake,
} from "@scout-for-lol/data";

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

/**
 * Both fees take and return branded money, so the boundary is the signature
 * rather than a convention each caller has to remember. A fee is always a
 * `BucksAmount`: zero when the house bets against itself, and never negative.
 *
 * The percentage itself is computed in BigInt. A money brand spans the whole
 * safe-integer range now that it no longer carries the Int32 cap, and
 * `value * HOUSE_CUT_PERCENT` leaves that range long before `value` does: the
 * product is rounded to the nearest representable double *before* the division
 * brings it back down, so the quotient is a plausible, in-range, wrong integer
 * that the schema would accept without complaint. `9_007_199_254_740_980` at
 * 20% floors to `1_801_439_850_948_195` in doubles and
 * `1_801_439_850_948_196` exactly. BigInt keeps the product exact; the parse
 * on the way out is then a real bound, catching only a fee that genuinely
 * leaves the money domain.
 */

/** Re-enter the money domain. A fee outside it is a broken invariant, not a
 * clamp: the schema throws, matching the checked-arithmetic contract. */
function toBucksFee(cut: bigint): BucksAmount {
  return BucksAmountSchema.parse(Number(cut));
}

/** Round down, so a winning 1 BB match still profits. Truncating BigInt
 * division is floor across the non-negative money domain. */
function houseCutRoundedDown(amount: BucksStake | BucksAmount): BucksAmount {
  return toBucksFee((BigInt(amount) * BigInt(HOUSE_CUT_PERCENT)) / 100n);
}

/**
 * Round to the nearest Buck, which is what a voluntary cancellation uses.
 *
 * `floor(x·p/100 + 1/2)` spelled over integers, so the halfway case lands the
 * same way `Math.round` put it — upward — without ever leaving exact
 * arithmetic. At 20% no integer stake actually produces a halfway value, but
 * `HOUSE_CUT_PERCENT` is a knob and the next value set may.
 */
function houseCutRoundedNearest(amount: BucksStake | BucksAmount): BucksAmount {
  const doubled = BigInt(amount) * BigInt(HOUSE_CUT_PERCENT) * 2n;
  return toBucksFee((doubled + 100n) / 200n);
}

/**
 * Charge a human winner against matched profit only. Even-money matching makes
 * matched profit equal matched stake before the fee.
 */
export function settlementHouseCut(input: {
  matchedProfit: BucksStake | BucksAmount;
  isHouse: boolean;
}): BucksAmount {
  if (input.isHouse) {
    return ZERO_BUCKS;
  }
  return houseCutRoundedDown(input.matchedProfit);
}

/** A voluntary cancellation returns the offer less the rounded fee. */
export function cancellationHouseCut(
  stake: BucksStake | BucksAmount,
): BucksAmount {
  return houseCutRoundedNearest(stake);
}
