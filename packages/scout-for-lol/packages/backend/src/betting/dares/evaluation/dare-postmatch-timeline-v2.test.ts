import { beforeAll, describe, expect, test } from "vitest";
import {
  RawMatchSchema,
  RawTimelineSchema,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  settleBucksWithDareTimelineV2,
  type DarePostmatchTimelineV2Dependencies,
} from "#src/betting/dares/evaluation/dare-postmatch-timeline-v2.ts";

let matchData: RawMatch;
let timeline: RawTimeline;

beforeAll(async () => {
  const fixture: unknown = await Bun.file(
    new URL("../../../../../../testdata/rift.json", import.meta.url),
  ).json();
  matchData = RawMatchSchema.parse(fixture);
  timeline = RawTimelineSchema.parse({
    metadata: {
      dataVersion: "2",
      matchId: matchData.metadata.matchId,
      participants: [matchData.info.participants[0]?.puuid],
    },
    info: {
      frameInterval: 60_000,
      gameId: matchData.info.gameId,
      participants: [
        {
          participantId: 1,
          puuid: matchData.info.participants[0]?.puuid,
        },
      ],
      frames: [
        {
          timestamp: 60_000,
          participantFrames: {},
          events: [
            {
              type: "ITEM_PURCHASED",
              timestamp: 61_000,
              participantId: 1,
              itemId: 3089,
            },
          ],
        },
      ],
    },
  });
});

const EMPTY_BUCKS_RESULT = {
  closures: [],
  settlements: [],
  parlaySettlements: [],
  dareSettlements: [],
  earnings: [],
};

describe("Dare v2 post-match timeline ordering", () => {
  test("retains and evaluates the timeline before settling, then reuses it", async () => {
    const order: string[] = [];
    const dependencies: DarePostmatchTimelineV2Dependencies = {
      needsTimeline: async () => true,
      fetchTimeline: async () => {
        order.push("fetch");
        return timeline;
      },
      captureRanks: async () => {
        order.push("rank");
        return { players: [], changes: new Map() };
      },
      settleBucks: async (_match, _prisma, options) => {
        order.push("settle");
        expect(options?.dareTimeline?.coverage).toBe("complete");
        expect(options?.dareTimeline?.events).toMatchObject([{ itemId: 3089 }]);
        return EMPTY_BUCKS_RESULT;
      },
    };
    const result = await settleBucksWithDareTimelineV2(
      { matchData, trackedPlayers: [] },
      dependencies,
    );

    expect(order).toEqual(["fetch", "rank", "settle"]);
    expect(result.prefetchedTimeline).toBe(timeline);
  });

  test("does not fetch a timeline when no active contract needs one", async () => {
    let fetched = false;
    let receivedTimeline = false;
    const dependencies: DarePostmatchTimelineV2Dependencies = {
      needsTimeline: async () => false,
      fetchTimeline: async () => {
        fetched = true;
        return timeline;
      },
      captureRanks: async () => ({ players: [], changes: new Map() }),
      settleBucks: async (_match, _prisma, options) => {
        receivedTimeline = options?.dareTimeline !== undefined;
        return EMPTY_BUCKS_RESULT;
      },
    };
    const result = await settleBucksWithDareTimelineV2(
      { matchData, trackedPlayers: [] },
      dependencies,
    );

    expect(fetched).toBe(false);
    expect(receivedTimeline).toBe(false);
    expect(result.prefetchedTimeline).toBeUndefined();
  });

  test("does not settle Dare evidence when required rank capture fails", async () => {
    let settled = false;
    const dependencies: DarePostmatchTimelineV2Dependencies = {
      needsTimeline: async () => false,
      fetchTimeline: async () => timeline,
      captureRanks: async () => {
        throw new Error("Riot unavailable");
      },
      settleBucks: async () => {
        settled = true;
        return EMPTY_BUCKS_RESULT;
      },
    };
    await expect(
      settleBucksWithDareTimelineV2(
        { matchData, trackedPlayers: [] },
        dependencies,
      ),
    ).rejects.toThrow("Riot unavailable");
    expect(settled).toBe(false);
  });
});
