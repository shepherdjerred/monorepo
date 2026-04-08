import { describe, expect, test } from "bun:test";
import {
  LoadingScreenDataSchema,
  LoadingScreenParticipantSchema,
  LoadingScreenBanSchema,
  LoadingScreenLayoutSchema,
  SummonerSpellIdSchema,
  RuneIdSchema,
  LoadingScreenChampionIdSchema,
} from "#src/model/loading-screen.ts";

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
  test("SummonerSpellIdSchema accepts valid IDs", () => {
    expect(() => SummonerSpellIdSchema.parse(4)).not.toThrow();
    expect(() => SummonerSpellIdSchema.parse(14)).not.toThrow();
    expect(() => SummonerSpellIdSchema.parse(0)).not.toThrow();
  });

  test("SummonerSpellIdSchema rejects negative numbers", () => {
    expect(() => SummonerSpellIdSchema.parse(-1)).toThrow();
  });

  test("RuneIdSchema accepts valid IDs", () => {
    expect(() => RuneIdSchema.parse(8005)).not.toThrow();
  });

  test("RuneIdSchema rejects zero and negative", () => {
    expect(() => RuneIdSchema.parse(0)).toThrow();
    expect(() => RuneIdSchema.parse(-1)).toThrow();
  });

  test("LoadingScreenChampionIdSchema accepts valid IDs", () => {
    expect(() => LoadingScreenChampionIdSchema.parse(1)).not.toThrow();
    expect(() => LoadingScreenChampionIdSchema.parse(266)).not.toThrow();
  });

  test("LoadingScreenChampionIdSchema rejects zero and negative", () => {
    expect(() => LoadingScreenChampionIdSchema.parse(0)).toThrow();
    expect(() => LoadingScreenChampionIdSchema.parse(-1)).toThrow();
  });
});

describe("LoadingScreenParticipantSchema", () => {
  const validParticipant = {
    puuid: "abc-123",
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
    expect(result.puuid).toBe("abc-123");
    expect(result.keystoneRuneId).toBeUndefined();
    expect(result.secondaryTreeId).toBeUndefined();
    expect(result.ranks).toBeUndefined();
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

  test("accepts arena participant with numeric team", () => {
    const arenaParticipant = {
      ...validParticipant,
      team: 3, // Arena team number
    };
    const result = LoadingScreenParticipantSchema.parse(arenaParticipant);
    expect(result.team).toBe(3);
  });

  test("rejects negative skin number", () => {
    expect(() =>
      LoadingScreenParticipantSchema.parse({
        ...validParticipant,
        skinNum: -1,
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

const makeParticipant = (puuid: string, team: "blue" | "red") => ({
  puuid,
  summonerName: `Player-${puuid}`,
  championName: "Aatrox",
  championDisplayName: "Aatrox",
  skinNum: 0,
  team,
  spell1Id: SummonerSpellIdSchema.parse(4),
  spell2Id: SummonerSpellIdSchema.parse(14),
  isTrackedPlayer: false,
});

describe("LoadingScreenDataSchema", () => {
  const validData = {
    gameId: 12_345,
    queueType: "solo",
    queueDisplayName: "Ranked Solo",
    isRanked: true,
    layout: "standard",
    mapName: "Summoner's Rift",
    participants: [
      makeParticipant("p1", "blue"),
      makeParticipant("p2", "blue"),
      makeParticipant("p3", "blue"),
      makeParticipant("p4", "blue"),
      makeParticipant("p5", "blue"),
      makeParticipant("p6", "red"),
      makeParticipant("p7", "red"),
      makeParticipant("p8", "red"),
      makeParticipant("p9", "red"),
      makeParticipant("p10", "red"),
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
    expect(result.gameId).toBe(12_345);
    expect(result.layout).toBe("standard");
    expect(result.participants).toHaveLength(10);
    expect(result.bans).toHaveLength(2);
  });

  test("accepts ARAM game with no bans", () => {
    const aramData = {
      ...validData,
      queueType: "aram",
      queueDisplayName: "ARAM",
      isRanked: false,
      layout: "aram",
      mapName: "Howling Abyss",
      bans: [],
    };
    const result = LoadingScreenDataSchema.parse(aramData);
    expect(result.layout).toBe("aram");
    expect(result.bans).toHaveLength(0);
  });

  test("accepts Arena game with numeric team IDs", () => {
    const arenaParticipants = Array.from({ length: 16 }, (_, i) => ({
      puuid: `arena-p${i.toString()}`,
      summonerName: `ArenaPlayer${i.toString()}`,
      championName: "Aatrox",
      championDisplayName: "Aatrox",
      skinNum: 0,
      team: (i % 8) + 1,
      spell1Id: SummonerSpellIdSchema.parse(4),
      spell2Id: SummonerSpellIdSchema.parse(14),
      isTrackedPlayer: false,
    }));
    const arenaData = {
      ...validData,
      queueType: "arena",
      queueDisplayName: "Arena",
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

  test("accepts data without queueType (unknown queue)", () => {
    const unknownQueue = {
      ...validData,
      queueType: undefined,
      queueDisplayName: "CLASSIC",
    };
    const result = LoadingScreenDataSchema.parse(unknownQueue);
    expect(result.queueType).toBeUndefined();
  });

  test("rejects negative gameId", () => {
    expect(() =>
      LoadingScreenDataSchema.parse({ ...validData, gameId: -1 }),
    ).toThrow();
  });
});
