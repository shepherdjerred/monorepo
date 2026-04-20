import { describe, expect, test } from "bun:test";
import {
  LoadingScreenDataSchema,
  LoadingScreenParticipantSchema,
  LoadingScreenBanSchema,
  LoadingScreenLayoutSchema,
  SummonerSpellIdSchema,
  RuneIdSchema,
  LoadingScreenChampionIdSchema,
  GameIdSchema,
  QueueDisplayNameSchema,
  makeQueueDisplayName,
} from "#src/model/loading-screen.ts";
import { LeaguePuuidSchema } from "#src/model/league-account.ts";
import { ArenaTeamIdSchema } from "#src/model/arena/arena.ts";

const samplePuuid =
  "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123";

describe("LoadingScreenLayoutSchema", () => {
  test("accepts valid layouts", () => {
    expect(LoadingScreenLayoutSchema.parse("standard")).toBe("standard");
    expect(LoadingScreenLayoutSchema.parse("aram")).toBe("aram");
    expect(LoadingScreenLayoutSchema.parse("arena")).toBe("arena");
  });

  test("rejects invalid layout", () => {
    expect(() => LoadingScreenLayoutSchema.parse("invalid")).toThrow();
  });
});

describe("branded type schemas", () => {
  test("SummonerSpellIdSchema accepts non-negative ints", () => {
    expect(() => SummonerSpellIdSchema.parse(4)).not.toThrow();
    expect(() => SummonerSpellIdSchema.parse(0)).not.toThrow();
  });

  test("SummonerSpellIdSchema rejects negative numbers", () => {
    expect(() => SummonerSpellIdSchema.parse(-1)).toThrow();
  });

  test("RuneIdSchema accepts positive ints", () => {
    expect(() => RuneIdSchema.parse(8005)).not.toThrow();
  });

  test("RuneIdSchema rejects zero and negative", () => {
    expect(() => RuneIdSchema.parse(0)).toThrow();
    expect(() => RuneIdSchema.parse(-1)).toThrow();
  });

  test("LoadingScreenChampionIdSchema accepts positive ints", () => {
    expect(() => LoadingScreenChampionIdSchema.parse(1)).not.toThrow();
  });

  test("LoadingScreenChampionIdSchema rejects zero and negative", () => {
    expect(() => LoadingScreenChampionIdSchema.parse(0)).toThrow();
  });

  test("GameIdSchema accepts positive ints", () => {
    expect(() => GameIdSchema.parse(5_532_792_625)).not.toThrow();
  });

  test("GameIdSchema rejects zero and negative", () => {
    expect(() => GameIdSchema.parse(0)).toThrow();
    expect(() => GameIdSchema.parse(-1)).toThrow();
  });

  test("QueueDisplayNameSchema rejects empty strings", () => {
    expect(() => QueueDisplayNameSchema.parse("")).toThrow();
    expect(() => QueueDisplayNameSchema.parse("ranked solo")).not.toThrow();
  });

  test("makeQueueDisplayName returns branded display name", () => {
    expect(() => makeQueueDisplayName("solo")).not.toThrow();
    expect(() => makeQueueDisplayName("aram")).not.toThrow();
  });
});

describe("LoadingScreenParticipantSchema", () => {
  const validParticipant = {
    puuid: LeaguePuuidSchema.parse(samplePuuid),
    summonerName: "TestPlayer",
    championName: "Aatrox",
    championDisplayName: "Aatrox",
    skinNum: 0,
    team: "blue",
    spell1Id: SummonerSpellIdSchema.parse(4),
    spell2Id: SummonerSpellIdSchema.parse(14),
    isTrackedPlayer: false,
  };

  test("accepts valid participant without optional fields", () => {
    const result = LoadingScreenParticipantSchema.parse(validParticipant);
    expect(result.keystoneRuneId).toBeUndefined();
    expect(result.secondaryTreeId).toBeUndefined();
    expect(result.ranks).toBeUndefined();
  });

  test("accepts participant with null puuid", () => {
    const withNullPuuid = { ...validParticipant, puuid: null };
    const result = LoadingScreenParticipantSchema.parse(withNullPuuid);
    expect(result.puuid).toBeNull();
  });

  test("accepts participant with runes and ranks", () => {
    const withOptionals = {
      ...validParticipant,
      keystoneRuneId: RuneIdSchema.parse(8005),
      secondaryTreeId: RuneIdSchema.parse(8200),
      ranks: {
        solo: {
          tier: "gold",
          division: 2,
          lp: 45,
          wins: 100,
          losses: 90,
        },
        flex: {
          tier: "silver",
          division: 1,
          lp: 75,
          wins: 50,
          losses: 40,
        },
      },
      isTrackedPlayer: true,
    };
    const result = LoadingScreenParticipantSchema.parse(withOptionals);
    expect(Number(result.keystoneRuneId)).toBe(8005);
    expect(result.ranks?.solo?.tier).toBe("gold");
    expect(result.ranks?.flex?.tier).toBe("silver");
    expect(result.isTrackedPlayer).toBe(true);
  });

  test("accepts arena participant with arenaTeam object", () => {
    const arenaParticipant = {
      ...validParticipant,
      team: { arenaTeam: ArenaTeamIdSchema.parse(3) },
    };
    const result = LoadingScreenParticipantSchema.parse(arenaParticipant);
    expect(result.team).toEqual({ arenaTeam: ArenaTeamIdSchema.parse(3) });
  });

  test("rejects negative skin number", () => {
    expect(() =>
      LoadingScreenParticipantSchema.parse({
        ...validParticipant,
        skinNum: -1,
      }),
    ).toThrow();
  });

  test("rejects empty summonerName", () => {
    expect(() =>
      LoadingScreenParticipantSchema.parse({
        ...validParticipant,
        summonerName: "",
      }),
    ).toThrow();
  });

  test("rejects extra fields (strict mode)", () => {
    expect(() =>
      LoadingScreenParticipantSchema.parse({
        ...validParticipant,
        extraField: "should fail",
      }),
    ).toThrow();
  });
});

describe("LoadingScreenBanSchema", () => {
  test("accepts valid ban", () => {
    const result = LoadingScreenBanSchema.parse({
      championId: LoadingScreenChampionIdSchema.parse(1),
      championName: "Annie",
      team: "blue",
    });
    expect(Number(result.championId)).toBe(1);
    expect(result.team).toBe("blue");
  });

  test("rejects invalid team value", () => {
    expect(() =>
      LoadingScreenBanSchema.parse({
        championId: LoadingScreenChampionIdSchema.parse(1),
        championName: "Annie",
        team: "purple",
      }),
    ).toThrow();
  });
});

function makePuuid(suffix: string) {
  return LeaguePuuidSchema.parse(`${samplePuuid}${suffix}`.slice(0, 78));
}

function makeParticipant(puuid: string, team: "blue" | "red") {
  return {
    puuid: LeaguePuuidSchema.parse(puuid),
    summonerName: `Player-${puuid.slice(0, 4)}`,
    championName: "Aatrox",
    championDisplayName: "Aatrox",
    skinNum: 0,
    team,
    spell1Id: SummonerSpellIdSchema.parse(4),
    spell2Id: SummonerSpellIdSchema.parse(14),
    isTrackedPlayer: false,
  };
}

describe("LoadingScreenDataSchema", () => {
  const validData = {
    gameId: GameIdSchema.parse(12_345),
    queueType: "solo",
    queueDisplayName: makeQueueDisplayName("solo"),
    isRanked: true,
    layout: "standard",
    mapName: "Summoner's Rift",
    participants: [
      makeParticipant(makePuuid("01"), "blue"),
      makeParticipant(makePuuid("02"), "blue"),
      makeParticipant(makePuuid("03"), "blue"),
      makeParticipant(makePuuid("04"), "blue"),
      makeParticipant(makePuuid("05"), "blue"),
      makeParticipant(makePuuid("06"), "red"),
      makeParticipant(makePuuid("07"), "red"),
      makeParticipant(makePuuid("08"), "red"),
      makeParticipant(makePuuid("09"), "red"),
      makeParticipant(makePuuid("10"), "red"),
    ],
    bans: [
      {
        championId: LoadingScreenChampionIdSchema.parse(1),
        championName: "Annie",
        team: "blue",
      },
      {
        championId: LoadingScreenChampionIdSchema.parse(2),
        championName: "Olaf",
        team: "red",
      },
    ],
    gameStartTime: Date.now(),
  };

  test("accepts valid standard game data", () => {
    const result = LoadingScreenDataSchema.parse(validData);
    expect(Number(result.gameId)).toBe(12_345);
    expect(result.layout).toBe("standard");
    expect(result.participants).toHaveLength(10);
    expect(result.bans).toHaveLength(2);
  });

  test("accepts ARAM game with no bans", () => {
    const aramData = {
      ...validData,
      queueType: "aram",
      queueDisplayName: makeQueueDisplayName("aram"),
      isRanked: false,
      layout: "aram",
      mapName: "Howling Abyss",
      bans: [],
    };
    const result = LoadingScreenDataSchema.parse(aramData);
    expect(result.layout).toBe("aram");
    expect(result.bans).toHaveLength(0);
  });

  test("accepts Arena game with arenaTeam discriminated union", () => {
    const arenaParticipants = Array.from({ length: 16 }, (_, i) => ({
      puuid: makePuuid(`a${i.toString().padStart(2, "0")}`),
      summonerName: `ArenaPlayer${i.toString()}`,
      championName: "Aatrox",
      championDisplayName: "Aatrox",
      skinNum: 0,
      team: { arenaTeam: ArenaTeamIdSchema.parse((i % 8) + 1) },
      spell1Id: SummonerSpellIdSchema.parse(4),
      spell2Id: SummonerSpellIdSchema.parse(14),
      isTrackedPlayer: false,
    }));
    const arenaData = {
      ...validData,
      queueType: "arena",
      queueDisplayName: makeQueueDisplayName("arena"),
      isRanked: false,
      layout: "arena",
      mapName: "Rings of Wrath",
      participants: arenaParticipants,
      bans: [],
    };
    const result = LoadingScreenDataSchema.parse(arenaData);
    expect(result.layout).toBe("arena");
    expect(result.participants).toHaveLength(16);
  });

  test("rejects unknown map name", () => {
    expect(() =>
      LoadingScreenDataSchema.parse({
        ...validData,
        mapName: "Mystery Island",
      }),
    ).toThrow();
  });

  test("requires queueType (no longer optional)", () => {
    const noQueueType = { ...validData };
    Reflect.deleteProperty(noQueueType, "queueType");
    expect(() => LoadingScreenDataSchema.parse(noQueueType)).toThrow();
  });

  test("rejects zero gameId", () => {
    expect(() =>
      LoadingScreenDataSchema.parse({
        ...validData,
        gameId: 0,
      }),
    ).toThrow();
  });
});
