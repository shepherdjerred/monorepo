export type CompleteBucksAllocation = {
  humanMatchedStake: number;
  houseMatchedStake: number;
  matchedStake: number;
  unmatchedStake: number;
};

/** Fail closed before any payout trusts a persisted close-time allocation. */
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
    humanMatchedStake,
    houseMatchedStake,
    matchedStake,
    unmatchedStake,
  };
}
