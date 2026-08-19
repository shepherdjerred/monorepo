import type { RiotTeamId } from "@scout-for-lol/data";

export type MatchableOffer = {
  betId: number;
  bucksAccountId: number;
  predictedTeamId: RiotTeamId;
  submittedStake: number;
};

export type MatchedOffer = MatchableOffer & {
  humanMatchedStake: number;
  houseMatchedStake: number;
  matchedStake: number;
  unmatchedStake: number;
};

export type MatchingResult = {
  humanMatchedPerSide: number;
  houseFill: number;
  houseTeamId: RiotTeamId | null;
  totalMatchedPerSide: number;
  allocations: MatchedOffer[];
};

type WeightedOffer = {
  betId: number;
  weight: number;
};

/**
 * Allocate an integer total proportionally, then hand remaining whole Bucks to
 * the largest fractional remainders. Bet ID is the stable final tie-breaker.
 */
function allocateProRata(
  total: number,
  offers: readonly WeightedOffer[],
): Map<number, number> {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    offers.some(
      (offer) =>
        !Number.isSafeInteger(offer.weight) ||
        offer.weight < 0 ||
        !Number.isSafeInteger(offer.betId) ||
        offer.betId <= 0,
    )
  ) {
    throw new Error("Invalid proportional Bryan Bucks allocation input");
  }
  const weightTotal = offers.reduce(
    (sum, offer) => sum + BigInt(offer.weight),
    0n,
  );
  if (BigInt(total) > weightTotal) {
    throw new Error("Invalid proportional Bryan Bucks allocation input");
  }

  const allocations = new Map<number, number>();
  if (total === 0 || offers.length === 0) {
    for (const offer of offers) {
      allocations.set(offer.betId, 0);
    }
    return allocations;
  }
  if (weightTotal === 0n) {
    throw new Error("Cannot allocate Bryan Bucks across zero total weight");
  }

  const remainders: { betId: number; remainder: bigint }[] = [];
  let allocated = 0;
  for (const offer of offers) {
    const numerator = BigInt(total) * BigInt(offer.weight);
    const base = Number(numerator / weightTotal);
    allocations.set(offer.betId, base);
    allocated += base;
    remainders.push({ betId: offer.betId, remainder: numerator % weightTotal });
  }

  remainders.sort(
    (left, right) =>
      (left.remainder === right.remainder
        ? 0
        : left.remainder > right.remainder
          ? -1
          : 1) || left.betId - right.betId,
  );
  const remaining = total - allocated;
  for (let index = 0; index < remaining; index += 1) {
    const recipient = remainders[index];
    if (recipient === undefined) {
      throw new Error("Bryan Bucks remainder allocation had no recipient");
    }
    allocations.set(
      recipient.betId,
      (allocations.get(recipient.betId) ?? 0) + 1,
    );
  }
  return allocations;
}

function teamTotal(
  offers: readonly MatchableOffer[],
  teamId: RiotTeamId,
): number {
  const total = offers
    .filter((offer) => offer.predictedTeamId === teamId)
    .reduce((sum, offer) => sum + BigInt(offer.submittedStake), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError("Bryan Bucks team total exceeded safe integer range");
  }
  return Number(total);
}

/** Match humans first at even money, then use a bounded aggregate house fill. */
export function matchBucksOffers(input: {
  offers: readonly MatchableOffer[];
  houseMaximum: number;
  houseBalance: number;
}): MatchingResult {
  if (
    !Number.isSafeInteger(input.houseMaximum) ||
    input.houseMaximum < 0 ||
    !Number.isSafeInteger(input.houseBalance) ||
    input.houseBalance < 0
  ) {
    throw new Error("Invalid Bryan Bucks house capacity");
  }
  if (
    input.offers.some(
      (offer) =>
        !Number.isSafeInteger(offer.submittedStake) ||
        offer.submittedStake <= 0,
    )
  ) {
    throw new Error("Bryan Bucks offers must contain positive whole stakes");
  }
  if (
    new Set(input.offers.map((offer) => offer.betId)).size !==
    input.offers.length
  ) {
    throw new Error("Bryan Bucks matching received duplicate bet IDs");
  }

  const blueTotal = teamTotal(input.offers, 100);
  const redTotal = teamTotal(input.offers, 200);
  const humanMatchedPerSide = Math.min(blueTotal, redTotal);

  const humanByBet = new Map<number, number>();
  for (const teamId of [100, 200] as const) {
    const teamOffers = input.offers.filter(
      (offer) => offer.predictedTeamId === teamId,
    );
    const teamAllocations = allocateProRata(
      humanMatchedPerSide,
      teamOffers.map((offer) => ({
        betId: offer.betId,
        weight: offer.submittedStake,
      })),
    );
    for (const [betId, amount] of teamAllocations) {
      humanByBet.set(betId, amount);
    }
  }

  const largerTeamId: RiotTeamId | null =
    blueTotal > redTotal ? 100 : redTotal > blueTotal ? 200 : null;
  const gap = Math.abs(blueTotal - redTotal);
  const houseFill = Math.min(gap, input.houseMaximum, input.houseBalance);
  const houseTeamId: RiotTeamId | null =
    houseFill === 0 || largerTeamId === null
      ? null
      : largerTeamId === 100
        ? 200
        : 100;

  const houseByBet = new Map<number, number>();
  if (largerTeamId !== null && houseFill > 0) {
    const unmatchedOffers = input.offers
      .filter((offer) => offer.predictedTeamId === largerTeamId)
      .map((offer) => ({
        betId: offer.betId,
        weight: offer.submittedStake - (humanByBet.get(offer.betId) ?? 0),
      }));
    for (const [betId, amount] of allocateProRata(houseFill, unmatchedOffers)) {
      houseByBet.set(betId, amount);
    }
  }

  const allocations = [...input.offers]
    .sort((left, right) => left.betId - right.betId)
    .map((offer) => {
      const humanMatchedStake = humanByBet.get(offer.betId) ?? 0;
      const houseMatchedStake = houseByBet.get(offer.betId) ?? 0;
      const matchedStake = humanMatchedStake + houseMatchedStake;
      const unmatchedStake = offer.submittedStake - matchedStake;
      return {
        ...offer,
        humanMatchedStake,
        houseMatchedStake,
        matchedStake,
        unmatchedStake,
      };
    });

  const totalMatchedPerSide = humanMatchedPerSide + houseFill;
  if (!Number.isSafeInteger(totalMatchedPerSide)) {
    throw new TypeError(
      "Bryan Bucks matched total exceeded safe integer range",
    );
  }
  for (const teamId of [100, 200] as const) {
    const matched = allocations
      .filter((allocation) => allocation.predictedTeamId === teamId)
      .reduce((sum, allocation) => sum + allocation.matchedStake, 0);
    const finalMatched = teamId === houseTeamId ? matched + houseFill : matched;
    if (finalMatched !== totalMatchedPerSide) {
      throw new Error(
        `Bryan Bucks matching did not balance team ${teamId.toString()}`,
      );
    }
  }

  return {
    humanMatchedPerSide,
    houseFill,
    houseTeamId,
    totalMatchedPerSide,
    allocations,
  };
}
