import { describe, expect, test } from "vitest";
import type { RiotTeamId } from "@scout-for-lol/data";
import {
  matchBucksOffers,
  type MatchableOffer,
} from "#src/betting/markets/matching.ts";

function offer(
  betId: number,
  predictedTeamId: RiotTeamId,
  submittedStake: number,
): MatchableOffer {
  return {
    betId,
    bucksAccountId: betId + 100,
    predictedTeamId,
    submittedStake,
  };
}

function match(offers: readonly MatchableOffer[], houseBalance = 10_000) {
  return matchBucksOffers({ offers, houseMaximum: 5, houseBalance });
}

describe("matchBucksOffers", () => {
  test("leaves an empty market empty", () => {
    expect(match([])).toEqual({
      humanMatchedPerSide: 0,
      houseFill: 0,
      houseTeamId: null,
      totalMatchedPerSide: 0,
      allocations: [],
    });
  });

  test("matches a balanced human market without the house", () => {
    expect(match([offer(1, 100, 5), offer(2, 200, 5)])).toMatchObject({
      humanMatchedPerSide: 5,
      houseFill: 0,
      houseTeamId: null,
      totalMatchedPerSide: 5,
      allocations: [
        {
          betId: 1,
          humanMatchedStake: 5,
          houseMatchedStake: 0,
          unmatchedStake: 0,
        },
        {
          betId: 2,
          humanMatchedStake: 5,
          houseMatchedStake: 0,
          unmatchedStake: 0,
        },
      ],
    });
  });

  test("uses four house Bucks for a five-versus-one market", () => {
    expect(match([offer(1, 100, 5), offer(2, 200, 1)])).toMatchObject({
      humanMatchedPerSide: 1,
      houseFill: 4,
      houseTeamId: 200,
      totalMatchedPerSide: 5,
      allocations: [
        {
          betId: 1,
          humanMatchedStake: 1,
          houseMatchedStake: 4,
          matchedStake: 5,
          unmatchedStake: 0,
        },
        {
          betId: 2,
          humanMatchedStake: 1,
          houseMatchedStake: 0,
          matchedStake: 1,
          unmatchedStake: 0,
        },
      ],
    });
  });

  test("caps the house at five Bucks for a ten-versus-one market", () => {
    expect(match([offer(1, 100, 10), offer(2, 200, 1)])).toMatchObject({
      humanMatchedPerSide: 1,
      houseFill: 5,
      houseTeamId: 200,
      totalMatchedPerSide: 6,
      allocations: [
        {
          betId: 1,
          humanMatchedStake: 1,
          houseMatchedStake: 5,
          matchedStake: 6,
          unmatchedStake: 4,
        },
        {
          betId: 2,
          humanMatchedStake: 1,
          houseMatchedStake: 0,
          matchedStake: 1,
          unmatchedStake: 0,
        },
      ],
    });
  });

  test("matches a one-sided offer up to the house cap", () => {
    expect(match([offer(1, 100, 10)])).toMatchObject({
      humanMatchedPerSide: 0,
      houseFill: 5,
      houseTeamId: 200,
      totalMatchedPerSide: 5,
      allocations: [
        {
          betId: 1,
          humanMatchedStake: 0,
          houseMatchedStake: 5,
          matchedStake: 5,
          unmatchedStake: 5,
        },
      ],
    });
  });

  test("uses only the house balance that is actually available", () => {
    expect(
      matchBucksOffers({
        offers: [offer(1, 100, 10)],
        houseMaximum: 5,
        houseBalance: 2,
      }),
    ).toMatchObject({
      houseFill: 2,
      totalMatchedPerSide: 2,
      allocations: [{ betId: 1, matchedStake: 2, unmatchedStake: 8 }],
    });
  });

  test("uses largest remainder with bet ID as a deterministic tie-breaker", () => {
    const result = matchBucksOffers({
      offers: [offer(20, 100, 1), offer(10, 100, 1), offer(30, 200, 1)],
      houseMaximum: 0,
      houseBalance: 0,
    });
    expect(result.allocations).toMatchObject([
      { betId: 10, humanMatchedStake: 1, unmatchedStake: 0 },
      { betId: 20, humanMatchedStake: 0, unmatchedStake: 1 },
      { betId: 30, humanMatchedStake: 1, unmatchedStake: 0 },
    ]);
  });

  test("allocates Int32-scale offers without overflowing intermediates", () => {
    const result = matchBucksOffers({
      offers: [
        offer(1, 100, 2_000_000_000),
        offer(2, 100, 2_000_000_000),
        offer(3, 200, 2_000_000_000),
      ],
      houseMaximum: 0,
      houseBalance: 0,
    });
    expect(result).toMatchObject({
      humanMatchedPerSide: 2_000_000_000,
      houseFill: 0,
      totalMatchedPerSide: 2_000_000_000,
      allocations: [
        {
          betId: 1,
          humanMatchedStake: 1_000_000_000,
          matchedStake: 1_000_000_000,
          unmatchedStake: 1_000_000_000,
        },
        {
          betId: 2,
          humanMatchedStake: 1_000_000_000,
          matchedStake: 1_000_000_000,
          unmatchedStake: 1_000_000_000,
        },
        {
          betId: 3,
          humanMatchedStake: 2_000_000_000,
          matchedStake: 2_000_000_000,
          unmatchedStake: 0,
        },
      ],
    });
  });

  test("allocates house fill across the remaining imbalance proportionally", () => {
    const result = match([
      offer(1, 100, 6),
      offer(2, 100, 3),
      offer(3, 200, 3),
    ]);
    expect(result).toMatchObject({
      humanMatchedPerSide: 3,
      houseFill: 5,
      allocations: [
        {
          betId: 1,
          humanMatchedStake: 2,
          houseMatchedStake: 3,
          matchedStake: 5,
          unmatchedStake: 1,
        },
        {
          betId: 2,
          humanMatchedStake: 1,
          houseMatchedStake: 2,
          matchedStake: 3,
          unmatchedStake: 0,
        },
        {
          betId: 3,
          humanMatchedStake: 3,
          houseMatchedStake: 0,
          matchedStake: 3,
          unmatchedStake: 0,
        },
      ],
    });
  });
});
