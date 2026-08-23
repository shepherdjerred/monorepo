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
    rankState: { status: "available", ranks: {} },
    isTrackedPlayer: false,
    ...overrides,
  });
}

describe("resolveParticipantRankDisplay", () => {
  test("renders Hidden for participants without a PUUID", () => {
    const participant = createParticipant({
      puuid: null,
      rankState: { status: "hidden" },
    });

    expect(resolveParticipantRankDisplay(participant, "solo")).toEqual({
      text: "Hidden",
      color: palette.grey[1],
    });
  });

  test("renders Error for failed League-V4 lookups", () => {
    const participant = createParticipant({ rankState: { status: "error" } });

    expect(resolveParticipantRankDisplay(participant, "solo")).toEqual({
      text: "Error",
      color: palette.teams.red,
    });
  });

  test("renders Unranked for a successful empty League-V4 response", () => {
    const participant = createParticipant();

    expect(resolveParticipantRankDisplay(participant, "solo")).toEqual({
      text: "Unranked",
      color: palette.grey[1],
    });
  });

  test("uses only Flex rank in ranked Flex games", () => {
    const participant = createParticipant({
      rankState: {
        status: "available",
        ranks: {
          solo: {
            tier: "diamond",
            division: 2,
            lp: 50,
            wins: 100,
            losses: 80,
          },
        },
      },
    });

    expect(resolveParticipantRankDisplay(participant, "flex").text).toBe(
      "Unranked",
    );
  });

  test("uses only Solo rank in ranked Solo games", () => {
    const participant = createParticipant({
      rankState: {
        status: "available",
        ranks: {
          flex: {
            tier: "emerald",
            division: 4,
            lp: 10,
            wins: 20,
            losses: 15,
          },
        },
      },
    });

    expect(resolveParticipantRankDisplay(participant, "solo").text).toBe(
      "Unranked",
    );
  });

  test("prefers Solo rank in non-ranked games", () => {
    const participant = createParticipant({
      rankState: {
        status: "available",
        ranks: {
          solo: {
            tier: "gold",
            division: 1,
            lp: 90,
            wins: 40,
            losses: 30,
          },
          flex: {
            tier: "silver",
            division: 2,
            lp: 10,
            wins: 5,
            losses: 5,
          },
        },
      },
    });

    expect(resolveParticipantRankDisplay(participant, "aram").text).toBe(
      "Gold I",
    );
  });

  test("labels a Flex fallback in non-ranked games", () => {
    const participant = createParticipant({
      rankState: {
        status: "available",
        ranks: {
          flex: {
            tier: "silver",
            division: 2,
            lp: 10,
            wins: 5,
            losses: 5,
          },
        },
      },
    });

    expect(resolveParticipantRankDisplay(participant, "aram").text).toBe(
      "Flex Silver II",
    );
  });

  test.each(["master", "grandmaster", "challenger"] as const)(
    "renders %s without a division suffix",
    (tier) => {
      const participant = createParticipant({
        rankState: {
          status: "available",
          ranks: {
            solo: {
              tier,
              division: 1,
              lp: 500,
              wins: 100,
              losses: 80,
            },
          },
        },
      });

      expect(resolveParticipantRankDisplay(participant, "solo").text).toBe(
        tier.charAt(0).toUpperCase() + tier.slice(1),
      );
    },
  );
});
