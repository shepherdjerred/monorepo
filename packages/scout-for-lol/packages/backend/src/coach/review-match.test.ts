import { describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  reviewableMatchParticipants,
  type StoredMatchCoverage,
} from "./review-match.ts";

const puuid = "p".repeat(78);

function reads(stored: StoredMatchCoverage | null) {
  return {
    storedMatchCoverage: () => Promise.resolve(stored),
    resultParticipants: () => Promise.resolve([puuid]),
  };
}

describe("reviewableMatchParticipants", () => {
  test("a Riot match document is reviewable", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_5555555555");
    expect(
      await reviewableMatchParticipants(reads("complete"), matchId),
    ).toEqual([puuid]);
  });

  test("a client canonical match Riot never publishes is reviewable", async () => {
    // Queue 4310 (ARAM Mayhem) and other client-only games carry a frozen
    // complete canonical match from the client's history bundle.
    const matchId = RiotMatchIdSchema.parse("NA1_5555555556");
    expect(
      await reviewableMatchParticipants(reads("complete"), matchId),
    ).toEqual([puuid]);
  });

  test("result evidence without a stored match document is not reviewable", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_5555555557");
    expect(await reviewableMatchParticipants(reads(null), matchId)).toBeNull();
  });

  test("an end-of-game record is not a document the review can read", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_5555555558");
    expect(
      await reviewableMatchParticipants(reads("end_of_game"), matchId),
    ).toBeNull();
  });
});
