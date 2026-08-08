import { describe, expect, test } from "bun:test";
import {
  LoadingScreenDataSchema,
  ClassicLoadingScreenDataSchema,
  LoadingScreenParticipantSchema,
  LoadingScreenBanSchema,
  LoadingScreenLayoutSchema,
  SummonerSpellIdSchema,
  RuneIdSchema,
  LoadingScreenChampionIdSchema,
  GameIdSchema,
  QueueDisplayNameSchema,
  makeQueueDisplayName,
  loadingScreenLayoutForQueueType,
  type LoadingScreenLayout,
} from "#src/model/loading-screen.ts";
import type { QueueType } from "#src/model/state.ts";
import { LeaguePuuidSchema } from "#src/model/league-account.ts";
import { ArenaTeamIdSchema } from "#src/model/arena/arena.ts";

const samplePuuid =
  "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123";

describe("LoadingScreenLayoutSchema", () => {
  test("accepts valid layouts", () => {
    expect(LoadingScreenLayoutSchema.parse("standard")).toBe("standard");
    expect(LoadingScreenLayoutSchema.parse("aram")).toBe("aram");
    expect(LoadingScreenLayoutSchema.parse("arena")).toBe("arena");
    expect(LoadingScreenLayoutSchema.parse("classic")).toBe("classic");
  });

  test("rejects invalid layout", () => {
    expect(() => LoadingScreenLayoutSchema.parse("invalid")).toThrow();
  });

  const queueLayoutCases: {
    queueType: QueueType;
    layout: LoadingScreenLayout;
  }[] = [
    { queueType: "aram", layout: "aram" },
    { queueType: "aram clash", layout: "aram" },
    { queueType: "aram mayhem", layout: "aram" },
    { queueType: "arena", layout: "arena" },
    { queueType: "classic", layout: "classic" },
    { queueType: "classic aram mayhem", layout: "classic" },
    { queueType: "solo", layout: "standard" },
    { queueType: "custom", layout: "standard" },
  ];

  test.each(queueLayoutCases)(
    "maps $queueType to the $layout layout",
    ({ queueType, layout }) => {
      expect(loadingScreenLayoutForQueueType(queueType)).toBe(layout);
    },
  );
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
    championId: LoadingScreenChampionIdSchema.parse(266),
    championName: "Aatrox",
    championDisplayName: "Aatrox",
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

  // Callers must pass the normalized Data Dragon key (`RekSai`, `KSante`,
  // `JarvanIV`) — the schema stores the key verbatim and downstream
  // consumers look up files by that exact string. This pins the contract.
  test.each(["RekSai", "KSante", "JarvanIV", "MonkeyKing", "Fiddlesticks"])(
    "accepts normalized Data Dragon key %s",
    (championName) => {
      const result = LoadingScreenParticipantSchema.parse({
        ...validParticipant,
        championName,
        championDisplayName: championName,
      });
      expect(result.championName).toBe(championName);
    },
  );

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

  test("accepts arena participant with unknown prematch team", () => {
    const arenaParticipant = {
      ...validParticipant,
      team: { arenaTeam: null },
    };
    const result = LoadingScreenParticipantSchema.parse(arenaParticipant);
    expect(result.team).toEqual({ arenaTeam: null });
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

function makeNonStandardParticipant(puuid: string, team: "blue" | "red") {
  return {
    puuid: LeaguePuuidSchema.parse(puuid),
    summonerName: `Player-${puuid.slice(0, 4)}`,
    championId: LoadingScreenChampionIdSchema.parse(266),
    championName: "Aatrox",
    championDisplayName: "Aatrox",
    team,
    spell1Id: SummonerSpellIdSchema.parse(4),
    spell2Id: SummonerSpellIdSchema.parse(14),
    isTrackedPlayer: false,
  };
}

function makeParticipant(
  puuid: string,
  team: "blue" | "red",
  lane: "top" | "jungle" | "middle" | "adc" | "support",
) {
  return {
    ...makeNonStandardParticipant(puuid, team),
    lane,
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
      makeParticipant(makePuuid("01"), "blue", "top"),
      makeParticipant(makePuuid("02"), "blue", "jungle"),
      makeParticipant(makePuuid("03"), "blue", "middle"),
      makeParticipant(makePuuid("04"), "blue", "adc"),
      makeParticipant(makePuuid("05"), "blue", "support"),
      makeParticipant(makePuuid("06"), "red", "top"),
      makeParticipant(makePuuid("07"), "red", "jungle"),
      makeParticipant(makePuuid("08"), "red", "middle"),
      makeParticipant(makePuuid("09"), "red", "adc"),
      makeParticipant(makePuuid("10"), "red", "support"),
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
    if (result.layout !== "standard") {
      throw new Error("expected standard loading-screen data");
    }
    expect(result.bans).toHaveLength(2);
  });

  test("rejects standard game participants without lanes", () => {
    const participantsWithoutLane = validData.participants.map(
      ({ lane: _lane, ...participant }) => participant,
    );
    expect(() =>
      LoadingScreenDataSchema.parse({
        ...validData,
        participants: participantsWithoutLane,
      }),
    ).toThrow();
  });

  test("accepts ARAM game with no bans", () => {
    const aramData = {
      ...validData,
      queueType: "aram",
      queueDisplayName: makeQueueDisplayName("aram"),
      isRanked: false,
      layout: "aram",
      mapName: "Howling Abyss",
      participants: [
        makeNonStandardParticipant(makePuuid("01"), "blue"),
        makeNonStandardParticipant(makePuuid("02"), "blue"),
        makeNonStandardParticipant(makePuuid("03"), "blue"),
        makeNonStandardParticipant(makePuuid("04"), "blue"),
        makeNonStandardParticipant(makePuuid("05"), "blue"),
        makeNonStandardParticipant(makePuuid("06"), "red"),
        makeNonStandardParticipant(makePuuid("07"), "red"),
        makeNonStandardParticipant(makePuuid("08"), "red"),
        makeNonStandardParticipant(makePuuid("09"), "red"),
        makeNonStandardParticipant(makePuuid("10"), "red"),
      ],
      bans: [],
    };
    const result = LoadingScreenDataSchema.parse(aramData);
    expect(result.layout).toBe("aram");
    if (result.layout !== "aram") {
      throw new Error("expected ARAM loading-screen data");
    }
    expect(result.bans).toHaveLength(0);
  });

  test.each([16, 18])(
    "accepts Arena game with %p participants and known or unknown arenaTeam discriminated union",
    (participantCount) => {
      const arenaParticipants = Array.from(
        { length: participantCount },
        (_, i) => ({
          puuid: makePuuid(`a${i.toString().padStart(2, "0")}`),
          summonerName: `ArenaPlayer${i.toString()}`,
          championId: LoadingScreenChampionIdSchema.parse(266),
          championName: "Aatrox",
          championDisplayName: "Aatrox",
          team: {
            arenaTeam: i < 8 ? ArenaTeamIdSchema.parse((i % 8) + 1) : null,
          },
          spell1Id: SummonerSpellIdSchema.parse(4),
          spell2Id: SummonerSpellIdSchema.parse(14),
          isTrackedPlayer: false,
        }),
      );
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
      expect(result.participants).toHaveLength(participantCount);
    },
  );

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

describe("ClassicLoadingScreenDataSchema", () => {
  test.each([
    [5, 5],
    [3, 2],
    [1, 1],
  ])("accepts Classic %iv%i teams", (blueCount, redCount) => {
    const participants = [
      ...Array.from({ length: blueCount }, (_, index) =>
        makeNonStandardParticipant(
          makePuuid(`c-blue-${index.toString()}`),
          "blue",
        ),
      ),
      ...Array.from({ length: redCount }, (_, index) =>
        makeNonStandardParticipant(
          makePuuid(`c-red-${index.toString()}`),
          "red",
        ),
      ),
    ];
    const result = ClassicLoadingScreenDataSchema.parse({
      gameId: GameIdSchema.parse(7_933_730_085),
      queueType: "classic",
      queueDisplayName: makeQueueDisplayName("classic"),
      layout: "classic",
      mapName: "Classic Rift",
      participants,
      gameStartTime: Date.now(),
    });
    expect(result.participants).toHaveLength(blueCount + redCount);
  });

  test.each([
    [0, 1],
    [1, 0],
    [6, 1],
    [1, 6],
  ])("rejects Classic %iv%i teams", (blueCount, redCount) => {
    const participants = [
      ...Array.from({ length: blueCount }, (_, index) =>
        makeNonStandardParticipant(
          makePuuid(`x-blue-${index.toString()}`),
          "blue",
        ),
      ),
      ...Array.from({ length: redCount }, (_, index) =>
        makeNonStandardParticipant(
          makePuuid(`x-red-${index.toString()}`),
          "red",
        ),
      ),
    ];
    expect(() =>
      ClassicLoadingScreenDataSchema.parse({
        gameId: GameIdSchema.parse(7_933_730_085),
        queueType: "classic",
        queueDisplayName: makeQueueDisplayName("classic"),
        layout: "classic",
        mapName: "Classic Rift",
        participants,
        gameStartTime: Date.now(),
      }),
    ).toThrow();
  });
});
