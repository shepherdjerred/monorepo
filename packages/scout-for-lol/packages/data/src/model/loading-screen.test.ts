import { describe, expect, test } from "bun:test";
import {
  LoadingScreenDataSchema,
  LoadingScreenParticipantSchema,
  LoadingScreenBanSchema,
  LoadingScreenLayoutSchema,
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

describe("LoadingScreenParticipantSchema", () => {
  const validParticipant = {
    puuid: "abc-123",
    summonerName: "TestPlayer",
    championName: "Aatrox",
    championDisplayName: "Aatrox",
    skinNum: 0,
    teamId: 100,
    spell1Id: 4,
    spell2Id: 14,
    isTrackedPlayer: false,
  };

  test("accepts valid participant without optional fields", () => {
    const result = LoadingScreenParticipantSchema.parse(validParticipant);
    expect(result.puuid).toBe("abc-123");
    expect(result.keystoneRuneId).toBeUndefined();
    expect(result.secondaryTreeId).toBeUndefined();
    expect(result.rank).toBeUndefined();
  });

  test("accepts participant with runes and rank", () => {
    const withOptionals = {
      ...validParticipant,
      keystoneRuneId: 8005,
      secondaryTreeId: 8200,
      rank: {
        tier: "gold",
        division: 2,
        lp: 45,
        wins: 100,
        losses: 90,
      },
      isTrackedPlayer: true,
    };
    const result = LoadingScreenParticipantSchema.parse(withOptionals);
    expect(result.keystoneRuneId).toBe(8005);
    expect(result.rank?.tier).toBe("gold");
    expect(result.isTrackedPlayer).toBe(true);
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
      championId: 1,
      championName: "Annie",
      teamId: 100,
    });
    expect(result.championId).toBe(1);
    expect(result.championName).toBe("Annie");
  });
});

describe("LoadingScreenDataSchema", () => {
  const makeParticipant = (
    puuid: string,
    teamId: number,
  ) => ({
    puuid,
    summonerName: `Player-${puuid}`,
    championName: "Aatrox",
    championDisplayName: "Aatrox",
    skinNum: 0,
    teamId,
    spell1Id: 4,
    spell2Id: 14,
    isTrackedPlayer: false,
  });

  const validData = {
    gameId: 12345,
    queueType: "solo",
    queueDisplayName: "Ranked Solo",
    isRanked: true,
    layout: "standard",
    mapName: "Summoner's Rift",
    participants: [
      makeParticipant("p1", 100),
      makeParticipant("p2", 100),
      makeParticipant("p3", 100),
      makeParticipant("p4", 100),
      makeParticipant("p5", 100),
      makeParticipant("p6", 200),
      makeParticipant("p7", 200),
      makeParticipant("p8", 200),
      makeParticipant("p9", 200),
      makeParticipant("p10", 200),
    ],
    bans: [
      { championId: 1, championName: "Annie", teamId: 100 },
      { championId: 2, championName: "Olaf", teamId: 200 },
    ],
    gameStartTime: Date.now(),
  };

  test("accepts valid standard game data", () => {
    const result = LoadingScreenDataSchema.parse(validData);
    expect(result.gameId).toBe(12345);
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

  test("accepts Arena game with 16 participants", () => {
    const arenaParticipants = Array.from({ length: 16 }, (_, i) =>
      makeParticipant(`arena-p${i.toString()}`, (i % 8) + 1),
    );
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
});
