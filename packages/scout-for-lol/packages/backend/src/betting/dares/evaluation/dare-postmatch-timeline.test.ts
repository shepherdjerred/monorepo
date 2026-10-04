import { beforeAll, describe, expect, test } from "vitest";
import {
  RawMatchSchema,
  RawTimelineSchema,
  type RawMatch,
  type RawTimeline,
} from "@scout-for-lol/data";
import {
  settleBucksWithDareTimeline,
  type DarePostmatchTimelineDependencies,
} from "#src/betting/dares/evaluation/dare-postmatch-timeline.ts";

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

describe("Dare post-match timeline ordering", () => {
  test("retains the timeline before settling, then reuses it", async () => {
    const order: string[] = [];
    const dependencies: DarePostmatchTimelineDependencies = {
      needsTimeline: async () => true,
      fetchTimeline: async () => {
        order.push("fetch");
        return timeline;
      },
      captureRanks: async () => {
        order.push("rank");
        return { players: [], changes: new Map() };
      },
      settleBucks: async () => {
        order.push("settle");
        return EMPTY_BUCKS_RESULT;
      },
    };
    const result = await settleBucksWithDareTimeline(
      { matchData, matchDataSource: "RIOT", trackedPlayers: [] },
      dependencies,
    );

    expect(order).toEqual(["fetch", "rank", "settle"]);
    expect(result.prefetchedTimeline).toBe(timeline);
  });

  test("does not fetch a timeline when no active contract needs one", async () => {
    let fetched = false;
    const dependencies: DarePostmatchTimelineDependencies = {
      needsTimeline: async () => false,
      fetchTimeline: async () => {
        fetched = true;
        return timeline;
      },
      captureRanks: async () => ({ players: [], changes: new Map() }),
      settleBucks: async () => EMPTY_BUCKS_RESULT,
    };
    const result = await settleBucksWithDareTimeline(
      { matchData, matchDataSource: "RIOT", trackedPlayers: [] },
      dependencies,
    );

    expect(fetched).toBe(false);
    expect(result.prefetchedTimeline).toBeUndefined();
  });

  test("settles a client-sourced match without asking Riot for a timeline", async () => {
    let fetched = false;
    let settled = false;
    const dependencies: DarePostmatchTimelineDependencies = {
      needsTimeline: async () => true,
      fetchTimeline: async () => {
        fetched = true;
        return timeline;
      },
      captureRanks: async () => ({ players: [], changes: new Map() }),
      settleBucks: async () => {
        settled = true;
        return EMPTY_BUCKS_RESULT;
      },
    };

    const result = await settleBucksWithDareTimeline(
      { matchData, matchDataSource: "SCOUT_CLIENT", trackedPlayers: [] },
      dependencies,
    );

    expect(fetched).toBe(false);
    expect(settled).toBe(true);
    expect(result.prefetchedTimeline).toBeNull();
  });

  test("does not settle Dare evidence when required rank capture fails", async () => {
    let settled = false;
    const dependencies: DarePostmatchTimelineDependencies = {
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
      settleBucksWithDareTimeline(
        { matchData, matchDataSource: "RIOT", trackedPlayers: [] },
        dependencies,
      ),
    ).rejects.toThrow("Riot unavailable");
    expect(settled).toBe(false);
  });
});
