import { describe, expect, test, mock } from "bun:test";
import {
  RawCurrentGameInfoSchema,
  LoadingScreenDataSchema,
  type Lane,
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

function makeArenaParticipants(
  baseGameInfo: Awaited<ReturnType<typeof loadSpectatorPayload>>,
  teamCount: number,
  teamSize: number,
  includeSubteamId: boolean,
) {
  const participantCount = teamCount * teamSize;

  return Array.from({ length: participantCount }).map((_, i) => {
    const template =
      baseGameInfo.participants[i % baseGameInfo.participants.length];
    if (template === undefined) {
      throw new Error("spectator fixture has no participants");
    }

    return {
      ...template,
      riotId: `Synthetic${(i + 1).toString()}#tag`,
      teamId: i < participantCount / 2 ? 100 : 200,
      playerSubteamId: includeSubteamId
        ? Math.floor(i / teamSize) + 1
        : undefined,
    };
  });
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
    if (parsed.layout !== "standard") {
      throw new Error("Expected standard loading screen data");
    }

    // Check participants
    expect(parsed.participants).toHaveLength(10);

    // Blue team = 5, Red team = 5
    const blueTeam = parsed.participants.filter((p) => p.team === "blue");
    const redTeam = parsed.participants.filter((p) => p.team === "red");
    expect(blueTeam).toHaveLength(5);
    expect(redTeam).toHaveLength(5);
    const expectedLanes: Lane[] = ["adc", "jungle", "middle", "support", "top"];
    expect(blueTeam.map((p) => p.lane).toSorted()).toEqual(
      expectedLanes.toSorted(),
    );
    expect(redTeam.map((p) => p.lane).toSorted()).toEqual(
      expectedLanes.toSorted(),
    );

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

    // Prematch loading screens intentionally use default champion skins.
    expect(parsed.participants.map((p) => p.skinNum)).toEqual(
      Array.from({ length: parsed.participants.length }, () => 0),
    );

    // Snapshot the full structure
    expect(parsed).toMatchSnapshot();
  });
});

describe("buildLoadingScreenData layout variants", () => {
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

  test.each([3200, 3270])(
    "queue %i (ARAM: Mayhem) resolves to ARAM layout",
    async (queueId) => {
      const baseGameInfo = await loadSpectatorPayload(
        `${currentDir}testdata/spectator-ranked-flex.json`,
      );

      const gameInfo = RawCurrentGameInfoSchema.parse({
        ...baseGameInfo,
        gameQueueConfigId: queueId,
        mapId: 12,
        gameMode: "ARAM",
        bannedChampions: [],
      });

      const result = await buildLoadingScreenData(
        gameInfo,
        new Set(),
        "AMERICA_NORTH",
      );

      const parsed = LoadingScreenDataSchema.parse(result);
      expect(parsed.queueType).toBe("aram mayhem");
      expect(parsed.layout).toBe("aram");
      expect(parsed.mapName).toBe("Howling Abyss");
    },
  );

  test("queue 3100 (Custom) resolves to standard layout", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 3100,
      gameMode: "CLASSIC",
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );

    const parsed = LoadingScreenDataSchema.parse(result);
    expect(parsed.queueType).toBe("custom");
    expect(parsed.layout).toBe("standard");
  });

  test("queue 0 (Custom) with CLASSIC mode stays custom standard layout", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 0,
      gameMode: "CLASSIC",
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );

    const parsed = LoadingScreenDataSchema.parse(result);
    expect(parsed.queueType).toBe("custom");
    expect(parsed.layout).toBe("standard");
  });
});

describe("buildLoadingScreenData with Arena spectator payloads", () => {
  test("queue 1700 (Arena) uses playerSubteamId for arenaTeam, not teamId", async () => {
    // Spectator V5 reports teamId as 100/200 even for Arena games — the real
    // 1-8 subteam comes from playerSubteamId. Ensure the loading screen
    // builder reads the correct field.
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const arenaParticipants = makeArenaParticipants(baseGameInfo, 8, 2, true);

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

  test("queue 1700 (Arena) preserves unknown arenaTeam when playerSubteamId is omitted", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const arenaParticipants = makeArenaParticipants(baseGameInfo, 8, 2, false);

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 1700,
      mapId: 30,
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
    expect(parsed.participants).toHaveLength(16);
    for (const participant of parsed.participants) {
      expect(participant.team).toEqual({ arenaTeam: null });
    }
  });

  test("CHERRY queue 0 uses arena layout and supports 18 players in six teams of three", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 0,
      mapId: 30,
      gameMode: "CHERRY",
      bannedChampions: [],
      participants: makeArenaParticipants(baseGameInfo, 6, 3, true),
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );

    const parsed = LoadingScreenDataSchema.parse(result);
    expect(parsed.queueType).toBe("arena");
    expect(parsed.layout).toBe("arena");
    expect(parsed.participants).toHaveLength(18);
    expect(parsed.participants[0]?.team).toEqual({ arenaTeam: 1 });
    expect(parsed.participants[1]?.team).toEqual({ arenaTeam: 1 });
    expect(parsed.participants[2]?.team).toEqual({ arenaTeam: 1 });
    expect(parsed.participants[3]?.team).toEqual({ arenaTeam: 2 });
    expect(parsed.participants[17]?.team).toEqual({ arenaTeam: 6 });
  });

  test("CHERRY queue 0 preserves unknown arenaTeam when 18 participants omit playerSubteamId", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 0,
      mapId: 30,
      gameMode: "CHERRY",
      bannedChampions: [],
      participants: makeArenaParticipants(baseGameInfo, 6, 3, false),
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );

    const parsed = LoadingScreenDataSchema.parse(result);
    expect(parsed.participants).toHaveLength(18);
    for (const participant of parsed.participants) {
      expect(participant.team).toEqual({ arenaTeam: null });
    }
  });

  test("queue 1700 (Arena) accepts real-style payloads without playerSubteamId", async () => {
    const baseGameInfo = await loadSpectatorPayload(
      `${currentDir}testdata/spectator-ranked-flex.json`,
    );

    const gameInfo = RawCurrentGameInfoSchema.parse({
      ...baseGameInfo,
      gameQueueConfigId: 1700,
      mapId: 30,
      gameMode: "CHERRY",
      bannedChampions: [],
      participants: makeArenaParticipants(baseGameInfo, 6, 3, false),
    });

    const result = await buildLoadingScreenData(
      gameInfo,
      new Set(),
      "AMERICA_NORTH",
    );

    const parsed = LoadingScreenDataSchema.parse(result);
    expect(parsed.layout).toBe("arena");
    expect(
      parsed.participants.every(
        (p) => typeof p.team !== "string" && p.team.arenaTeam === null,
      ),
    ).toBe(true);
  });
});
