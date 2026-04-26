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

  test("queue 2400 (ARAM: Mayhem) with Rek'Sai resolves without throwing", async () => {
    // Start from the ranked-flex payload and mutate just enough to simulate
    // an ARAM Mayhem game with Rek'Sai in it — the two previously-failing
    // code paths (queue 2400 unmapped, Reksai → RekSai asset lookup).
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 2400,
      mapId: 12, // Howling Abyss
      gameMode: "ARAM",
      bannedChampions: [],
      participants: baseGameInfo.participants.map((p, i) =>
        i === 0 ? { ...p, championId: 421 } : p,
      ),
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );

    const parsed = LoadingScreenDataSchema.parse(result);
    expect(parsed.queueType).toBe("aram mayhem");
    expect(String(parsed.queueDisplayName)).toBe("ARAM mayhem");
    expect(parsed.layout).toBe("aram");
    expect(parsed.mapName).toBe("Howling Abyss");
    expect(parsed.bans).toHaveLength(0);

    const reksai = parsed.participants.find((p) => p.championName === "RekSai");
    expect(reksai).toBeDefined();
    expect(reksai?.championDisplayName).toBe("Reksai");
  });

  test("queue 1700 (Arena) uses playerSubteamId for arenaTeam, not teamId", async () => {
    // Spectator V5 reports teamId as 100/200 even for Arena games — the real
    // 1-8 subteam comes from playerSubteamId. Ensure the loading screen
    // builder reads the correct field.
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    // Arena = 16 players in 8 subteams of 2. Take the first 10 from the
    // base payload and synthesise 6 more so we hit 16 total.
    const arenaParticipants = [
      ...baseGameInfo.participants.slice(0, 10),
      ...Array.from({ length: 6 }).map((_, i) => ({
        ...baseGameInfo.participants[i % 10]!,
        riotId: `Synthetic${(i + 1).toString()}#tag`,
      })),
    ].map((p, i) => ({
      ...p,
      teamId: i < 8 ? 100 : 200, // Spectator V5 still reports 100/200
      playerSubteamId: Math.floor(i / 2) + 1, // 8 subteams of 2
    }));

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 1700,
      mapId: 30, // Rings of Wrath
      gameMode: "CHERRY",
      bannedChampions: [],
      participants: arenaParticipants,
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );
    const parsed = LoadingScreenDataSchema.parse(result);

    expect(parsed.layout).toBe("arena");
    expect(parsed.queueType).toBe("arena");
    expect(parsed.mapName).toBe("Rings of Wrath");
    expect(parsed.participants).toHaveLength(16);
    // Each participant's team is { arenaTeam: 1..8 } — derived from
    // playerSubteamId, not from teamId (which was 100 or 200).
    for (const p of parsed.participants) {
      expect(p.team).toHaveProperty("arenaTeam");
    }
    // First two participants share subteam 1 (per our synthetic data).
    expect(parsed.participants[0]?.team).toEqual({ arenaTeam: 1 });
    expect(parsed.participants[1]?.team).toEqual({ arenaTeam: 1 });
    expect(parsed.participants[2]?.team).toEqual({ arenaTeam: 2 });
  });

  test("queue 1700 (Arena) throws clearly when playerSubteamId is missing", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 1700,
      mapId: 30,
      gameMode: "CHERRY",
      bannedChampions: [],
      // No playerSubteamId on participants — simulates the broken state
      // that produced the ZodError flood in Bugsink.
    });

    await expect(
      buildLoadingScreenData(gameInfo, new Set(), "AMERICA_NORTH"),
    ).rejects.toThrow(/playerSubteamId/);
  });
});
