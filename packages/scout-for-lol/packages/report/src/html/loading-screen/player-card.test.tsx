import { describe, expect, test } from "vitest";
import {
  StandardLoadingScreenParticipantSchema,
  type LoadingScreenParticipant,
} from "@scout-for-lol/data";
import { palette } from "@scout-for-lol/design-system/satori/colors";
import { resolveParticipantRankDisplay } from "#src/html/loading-screen/player-card.tsx";

function createParticipant(
  overrides?: Partial<LoadingScreenParticipant>,
): LoadingScreenParticipant {
  return StandardLoadingScreenParticipantSchema.parse({
    puuid: "a".repeat(78),
    summonerName: "TestSummoner#NA1",
    championId: 1,
    championName: "Annie",
    championDisplayName: "Annie",
    team: "blue",
    lane: "middle",
    spell1Id: 4,
    spell2Id: 14,
    isTrackedPlayer: false,
    ...overrides,
  });
}

describe("resolveParticipantRankDisplay", () => {
  test("returns Hidden when puuid is null (privacy-scrubbed)", () => {
    const participant = createParticipant({ puuid: null });
    const result = resolveParticipantRankDisplay(participant, "solo");

    expect(result.text).toBe("Hidden");
    expect(result.color).toBe(palette.grey[1]);
  });

  test("returns Hidden when ranks.hidden is true", () => {
    const participant = createParticipant({
      ranks: {
        hidden: true,
      },
    });
    const result = resolveParticipantRankDisplay(participant, "solo");

    expect(result.text).toBe("Hidden");
    expect(result.color).toBe(palette.grey[1]);
  });

  describe("in Flex matches (queueType: 'flex')", () => {
    test("prefers Flex rank over Solo rank when both are present", () => {
      const participant = createParticipant({
        ranks: {
          solo: { tier: "diamond", division: 2, lp: 50, wins: 100, losses: 80 },
          flex: { tier: "emerald", division: 4, lp: 10, wins: 20, losses: 15 },
          soloStatus: "ranked",
          flexStatus: "ranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "flex");

      expect(result.text).toBe("Emerald IV");
      expect(result.color).toBe(palette.gold[3]);
    });

    test("falls back to Solo rank when Flex rank is absent", () => {
      const participant = createParticipant({
        ranks: {
          solo: { tier: "diamond", division: 2, lp: 50, wins: 100, losses: 80 },
          flexStatus: "unranked",
          soloStatus: "ranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "flex");

      expect(result.text).toBe("Diamond II");
      expect(result.color).toBe(palette.gold[3]);
    });

    test("returns Unplaced when Flex is unplaced and no Solo rank exists", () => {
      const participant = createParticipant({
        ranks: {
          flexStatus: "unplaced",
          soloStatus: "unranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "flex");

      expect(result.text).toBe("Unplaced");
      expect(result.color).toBe(palette.gold[1]);
    });

    test("returns Error when Flex fetch failed and no Solo rank exists", () => {
      const participant = createParticipant({
        ranks: {
          flexStatus: "error",
          soloStatus: "error",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "flex");

      expect(result.text).toBe("Error");
      expect(result.color).toBe(palette.teams.red);
    });

    test("returns Unranked when confirmed unranked in both queues", () => {
      const participant = createParticipant({
        ranks: {
          flexStatus: "unranked",
          soloStatus: "unranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "flex");

      expect(result.text).toBe("Unranked");
      expect(result.color).toBe(palette.grey[1]);
    });
  });

  describe("in Solo/Duo matches (queueType: 'solo')", () => {
    test("prefers Solo rank over Flex rank when both are present", () => {
      const participant = createParticipant({
        ranks: {
          solo: { tier: "diamond", division: 2, lp: 50, wins: 100, losses: 80 },
          flex: { tier: "emerald", division: 4, lp: 10, wins: 20, losses: 15 },
          soloStatus: "ranked",
          flexStatus: "ranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "solo");

      expect(result.text).toBe("Diamond II");
      expect(result.color).toBe(palette.gold[3]);
    });

    test("falls back to Flex rank when Solo rank is absent", () => {
      const participant = createParticipant({
        ranks: {
          flex: { tier: "emerald", division: 4, lp: 10, wins: 20, losses: 15 },
          soloStatus: "unranked",
          flexStatus: "ranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "solo");

      expect(result.text).toBe("Emerald IV");
      expect(result.color).toBe(palette.gold[3]);
    });

    test("returns Unplaced when Solo is unplaced and no Flex rank exists", () => {
      const participant = createParticipant({
        ranks: {
          soloStatus: "unplaced",
          flexStatus: "unranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "solo");

      expect(result.text).toBe("Unplaced");
      expect(result.color).toBe(palette.gold[1]);
    });

    test("returns Error when Solo fetch failed and no Flex rank exists", () => {
      const participant = createParticipant({
        ranks: {
          soloStatus: "error",
          flexStatus: "error",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "solo");

      expect(result.text).toBe("Error");
      expect(result.color).toBe(palette.teams.red);
    });

    test("returns Unranked when confirmed unranked", () => {
      const participant = createParticipant({
        ranks: {
          soloStatus: "unranked",
          flexStatus: "unranked",
        },
      });

      const result = resolveParticipantRankDisplay(participant, "solo");

      expect(result.text).toBe("Unranked");
      expect(result.color).toBe(palette.grey[1]);
    });
  });

  describe("in non-ranked matches (e.g. ARAM, Normal)", () => {
    test("defaults to Solo rank first, falling back to Flex rank", () => {
      const participantSolo = createParticipant({
        ranks: {
          solo: { tier: "gold", division: 1, lp: 90, wins: 40, losses: 30 },
          flex: { tier: "silver", division: 2, lp: 10, wins: 5, losses: 5 },
          soloStatus: "ranked",
          flexStatus: "ranked",
        },
      });

      expect(resolveParticipantRankDisplay(participantSolo, "aram").text).toBe(
        "Gold I",
      );

      const participantFlexOnly = createParticipant({
        ranks: {
          flex: { tier: "silver", division: 2, lp: 10, wins: 5, losses: 5 },
          soloStatus: "unranked",
          flexStatus: "ranked",
        },
      });

      expect(
        resolveParticipantRankDisplay(participantFlexOnly, "aram").text,
      ).toBe("Silver II");
    });
  });
});
