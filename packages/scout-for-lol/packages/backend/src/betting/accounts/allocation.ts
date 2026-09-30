import {
  BucksAmountSchema,
  BucksStakeSchema,
  type BucksAmount,
  type BucksStake,
} from "@scout-for-lol/data";

export type CompleteBucksAllocation = {
  submittedStake: BucksStake;
  humanMatchedStake: BucksAmount;
  houseMatchedStake: BucksAmount;
  matchedStake: BucksAmount;
  unmatchedStake: BucksAmount;
};

/** Fail closed before any payout trusts a persisted close-time allocation.
 *
 * This is the storage boundary for allocation money: the conservation checks
 * run on the raw column values, and the returned fields are parsed into the
 * branded Bucks schemas so settlement arithmetic starts from validated
 * values.
 */
export function requireValidBucksAllocation(input: {
  betId: number;
  submittedStake: number;
  humanMatchedStake: number | null;
  houseMatchedStake: number | null;
  matchedStake: number | null;
  unmatchedStake: number | null;
}): CompleteBucksAllocation {
  const humanMatchedStake = input.humanMatchedStake;
  const houseMatchedStake = input.houseMatchedStake;
  const matchedStake = input.matchedStake;
  const unmatchedStake = input.unmatchedStake;
  if (
    humanMatchedStake === null ||
    houseMatchedStake === null ||
    matchedStake === null ||
    unmatchedStake === null
  ) {
    throw new Error(
      `Matched pool contains incomplete allocation for bet ${input.betId.toString()}`,
    );
  }

  const amounts = [
    input.submittedStake,
    humanMatchedStake,
    houseMatchedStake,
    matchedStake,
    unmatchedStake,
  ];
  if (
    !Number.isSafeInteger(input.submittedStake) ||
    input.submittedStake <= 0 ||
    amounts
      .slice(1)
      .some((value) => !Number.isSafeInteger(value) || value < 0) ||
    matchedStake !== humanMatchedStake + houseMatchedStake ||
    input.submittedStake !== matchedStake + unmatchedStake
  ) {
    throw new Error(
      `Matched pool contains non-conserving allocation for bet ${input.betId.toString()}`,
    );
  }

  return {
    submittedStake: BucksStakeSchema.parse(input.submittedStake),
    humanMatchedStake: BucksAmountSchema.parse(humanMatchedStake),
    houseMatchedStake: BucksAmountSchema.parse(houseMatchedStake),
    matchedStake: BucksAmountSchema.parse(matchedStake),
    unmatchedStake: BucksAmountSchema.parse(unmatchedStake),
  };
}
