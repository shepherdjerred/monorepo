import { describe, expect, test, mock } from "bun:test";
import {
  RawCurrentGameInfoSchema,
  LoadingScreenDataSchema,
} from "@scout-for-lol/data/index.ts";
import { buildLoadingScreenData } from "#src/league/tasks/prematch/loading-screen-builder.ts";

// Mock the rank fetcher to avoid real API calls in tests
void mock.module("#src/league/model/rank.ts", () => ({
  getRankByPuuid: async () => ({
    solo: {
      tier: "gold",
      division: 2,
      lp: 50,
      wins: 100,
      losses: 90,
    },
  }),
}));

const currentDir = new URL(".", import.meta.url).pathname;

async function loadSpectatorPayload(path: string) {
  const file = Bun.file(path);
  const json = (await file.json()) as unknown;
  return RawCurrentGameInfoSchema.parse(json);
}

describe("buildLoadingScreenData with real spectator payload", () => {
  test("transforms ranked flex payload into valid LoadingScreenData", async () => {
    const gameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const trackedPuuids = new Set([
      "AlYREV57O6o49QaM2iZVQ361vKtpc4mTwNYyqiZSLb9EF1EDBABA8xi4hiGwkSs1GIgRzXqjVm-2xg",
    ]);

    const result = await buildLoadingScreenData(
      gameInfo,
      trackedPuuids,
      "AMERICA_NORTH",
    );

    // Validate against Zod schema
    const parsed = LoadingScreenDataSchema.parse(result);

    // Check game-level fields
    expect(Number(parsed.gameId)).toBe(5_532_792_625);
    expect(parsed.queueType).toBe("flex");
    expect(parsed.isRanked).toBe(true);
    expect(parsed.layout).toBe("standard");
    expect(parsed.mapName).toBe("Summoner's Rift");

    // Check participants
    expect(parsed.participants).toHaveLength(10);

    // Blue team = 5, Red team = 5
    const blueTeam = parsed.participants.filter((p) => p.team === "blue");
    const redTeam = parsed.participants.filter((p) => p.team === "red");
    expect(blueTeam).toHaveLength(5);
    expect(redTeam).toHaveLength(5);

    // Check tracked player is flagged
    const trackedPlayer = parsed.participants.find(
      (p) => p.summonerName === "sjerred#sjerr",
    );
    expect(trackedPlayer?.isTrackedPlayer).toBe(true);

    // Check null puuid participant is not tracked
    const nullPuuidPlayer = parsed.participants.find(
      (p) => p.summonerName === "Nami",
    );
    expect(nullPuuidPlayer?.isTrackedPlayer).toBe(false);

    // Check bans (9 valid bans, 1 with championId=-1 filtered out)
    expect(parsed.bans.length).toBeGreaterThanOrEqual(9);

    // Check skin resolution uses lastSelectedSkinIndex
    const akaliPlayer = parsed.participants.find(
      (p) => p.summonerName === "Cain#3276",
    );
    expect(akaliPlayer?.skinNum).toBe(70);

    // Snapshot the full structure
    expect(parsed).toMatchSnapshot();
  });
});
