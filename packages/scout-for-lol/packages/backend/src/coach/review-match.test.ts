import { describe, expect, test, vi } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  reviewableMatchParticipants,
  type StoredMatchCoverage,
} from "./review-match.ts";

const puuid = "p".repeat(78);

function reads(
  stored: StoredMatchCoverage | null,
  participants: readonly string[] | null = [puuid],
) {
  return {
    storedMatchCoverage: vi.fn(() => Promise.resolve(stored)),
    resultParticipants: vi.fn(() => Promise.resolve(participants)),
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
    const stored = reads(null);
    expect(await reviewableMatchParticipants(stored, matchId)).toBeNull();
    // Nothing else is read for a game that has no frozen document yet.
    expect(stored.resultParticipants).not.toHaveBeenCalled();
  });

  test("a frozen end-of-game record is reviewable", async () => {
    // League Classic without match history: the record froze at its
    // deadline and was archived, so no complete document can replace it.
    const matchId = RiotMatchIdSchema.parse("NA1_5555555558");
    expect(
      await reviewableMatchParticipants(reads("end_of_game"), matchId),
    ).toEqual([puuid]);
  });

  test("an end-of-game record still waiting for its history bundle is not reviewable", async () => {
    // Before its deadline the record is only a candidate: nothing is
    // archived, so a bundle that arrives in time is what gets reviewed.
    const matchId = RiotMatchIdSchema.parse("NA1_5555555559");
    expect(await reviewableMatchParticipants(reads(null), matchId)).toBeNull();
  });

  test("a frozen document whose result is unresolved is not reviewable yet", async () => {
    const matchId = RiotMatchIdSchema.parse("NA1_5555555560");
    for (const coverage of ["complete", "end_of_game"] as const) {
      expect(
        await reviewableMatchParticipants(reads(coverage, null), matchId),
      ).toBeNull();
    }
  });
});
