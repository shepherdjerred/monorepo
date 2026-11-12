import { expect, test } from "vitest";
import {
  ExploreLoadoutCardRequestSchema,
  ExploreMatchCardRequestSchema,
} from "@scout-for-lol/data";
import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { reviewEligibility, withReviewCards } from "./review-cards.ts";

const matchId = RiotMatchIdSchema.parse("NA1_5635906027");
const otherMatchId = RiotMatchIdSchema.parse("NA1_5635906026");
const puuid = LeaguePuuidSchema.parse("9a7b7de0-ef0a-4efe-aec6-87e7e1e6f028");
const reviewed = {
  matchId,
  participantId: 3,
  puuid,
  cardSupported: true,
};

test("attaches an L match card and S loadout card when the model asked for none", () => {
  expect(
    withReviewCards({
      selection: { matchCards: [], loadoutCards: [] },
      reviewed,
    }),
  ).toEqual({
    matchCards: [{ matchId, size: "L" }],
    loadoutCards: [{ matchId, puuid, size: "S" }],
  });
});

test("does not duplicate cards the model already requested", () => {
  const selection = {
    matchCards: [ExploreMatchCardRequestSchema.parse({ matchId, size: "S" })],
    loadoutCards: [
      ExploreLoadoutCardRequestSchema.parse({ matchId, puuid, size: "S" }),
    ],
  };
  expect(withReviewCards({ selection, reviewed })).toBe(selection);
});

test("uses S when the model already used its one L, and adds no loadout without a puuid", () => {
  expect(
    withReviewCards({
      selection: {
        matchCards: [
          ExploreMatchCardRequestSchema.parse({
            matchId: otherMatchId,
            size: "L",
          }),
        ],
        loadoutCards: [],
      },
      reviewed: { ...reviewed, puuid: null },
    }),
  ).toEqual({
    matchCards: [
      { matchId: otherMatchId, size: "L" },
      { matchId, size: "S" },
    ],
    loadoutCards: [],
  });
});

test("respects the match and loadout caps", () => {
  const matchCards = Array.from({ length: 5 }, (_, index) =>
    ExploreMatchCardRequestSchema.parse({
      matchId: `NA1_${(5_635_906_000 + index).toString()}`,
      size: "S",
    }),
  );
  const loadoutCards = Array.from({ length: 3 }, (_, index) =>
    ExploreLoadoutCardRequestSchema.parse({
      matchId: otherMatchId,
      puuid: `9a7b7de0-ef0a-4efe-aec6-87e7e1e6f02${index.toString()}`,
      size: "S",
    }),
  );
  const selection = { matchCards, loadoutCards };
  expect(withReviewCards({ selection, reviewed })).toBe(selection);
});

test("skips the match card for an unsupported mode but still attaches the loadout", () => {
  expect(
    withReviewCards({
      selection: { matchCards: [], loadoutCards: [] },
      reviewed: { ...reviewed, cardSupported: false },
    }),
  ).toEqual({
    matchCards: [],
    loadoutCards: [{ matchId, puuid, size: "S" }],
  });
});

test("eligibility adds the reviewed match and pair to the query's choices", () => {
  const { eligibleMatchIds, eligibleLoadoutPairs } = reviewEligibility({
    lastMatchIds: new Set([otherMatchId]),
    lastQueryLoadoutPairs: new Set<string>(),
    reviewed,
  });
  expect(eligibleMatchIds).toEqual(new Set([otherMatchId, matchId]));
  expect(eligibleLoadoutPairs).toEqual(
    new Set([JSON.stringify([matchId, puuid])]),
  );
  expect(
    reviewEligibility({
      lastMatchIds: new Set<string>(),
      lastQueryLoadoutPairs: new Set<string>(),
      reviewed: { ...reviewed, cardSupported: false, puuid: null },
    }),
  ).toEqual({
    eligibleMatchIds: new Set<string>(),
    eligibleLoadoutPairs: new Set<string>(),
  });
});

test("no review leaves the selection untouched", () => {
  const selection = { matchCards: [], loadoutCards: [] };
  expect(withReviewCards({ selection, reviewed: null })).toBe(selection);
});
