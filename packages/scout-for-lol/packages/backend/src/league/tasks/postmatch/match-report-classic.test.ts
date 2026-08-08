import { describe, expect, mock, test } from "bun:test";
import {
  type ClassicMatch,
  PlayerConfigEntrySchema,
  RawMatchSchema,
  type RawMatch,
} from "@scout-for-lol/data";
import { classicMatchToImage, classicMatchToSvg } from "@scout-for-lol/report";
import { buildClassicMatch } from "./match-report-classic.ts";
import { generateMatchReport } from "./match-report-generator.ts";

const fixtureUrl = new URL(
  "../../../../../../testdata/rift.json",
  import.meta.url,
);
const realS3FixtureUrl = new URL(
  "testdata/match-classic-aram-mayhem-s3.json",
  import.meta.url,
);
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function classicMatchFixture(
  options: {
    queueId?: number;
    gameMode?: string;
    mapId?: number;
  } = {},
): Promise<RawMatch> {
  const input: unknown = await Bun.file(fixtureUrl).json();
  const base = RawMatchSchema.parse(input);
  const classicChampionIds = [
    60_103, 60_012, 60_032, 60_034, 60_001, 60_022, 60_053, 60_063, 60_031,
    60_042,
  ];
  return RawMatchSchema.parse({
    ...base,
    info: {
      ...base.info,
      queueId: options.queueId ?? 4310,
      gameMode: options.gameMode ?? "JADE",
      mapId: options.mapId ?? 453,
      participants: base.info.participants.map((participant, index) => ({
        ...participant,
        championId: classicChampionIds[index],
        championName: "Classic",
        riotIdGameName: `Classic Player ${(index + 1).toString()}`,
        riotIdTagline: `J${(index + 1).toString().padStart(2, "0")}`,
        summoner1Id: 74,
        summoner2Id: 714,
        item0: 771_001,
        item1: 771_004,
        item2: 771_006,
        item3: 771_011,
        item4: 771_018,
        item5: 771_026,
        item6: 0,
      })),
    },
  });
}

type ClassicIdentityOverrides = {
  readonly riotIdGameName: string | undefined;
  readonly riotIdTagline: string;
  readonly summonerName: string;
};

async function buildFirstParticipantClassicMatch(
  identity: ClassicIdentityOverrides,
): Promise<ClassicMatch> {
  const fixture = await classicMatchFixture();
  const rawMatch = RawMatchSchema.parse({
    ...fixture,
    info: {
      ...fixture.info,
      participants: fixture.info.participants.map((participant, index) =>
        index === 0 ? { ...participant, ...identity } : participant,
      ),
    },
  });
  const trackedParticipant = rawMatch.info.participants[0];
  if (trackedParticipant === undefined) {
    throw new Error("Classic identity fixture has no tracked participant");
  }
  const trackedPlayer = PlayerConfigEntrySchema.parse({
    alias: "Classic Identity",
    league: {
      leagueAccount: {
        puuid: trackedParticipant.puuid,
        region: "AMERICA_NORTH",
      },
    },
  });
  const result = buildClassicMatch(rawMatch, [trackedPlayer]);
  if (result === undefined) {
    throw new Error("Classic identity fixture unexpectedly produced no match");
  }
  return result;
}

describe("buildClassicMatch identity normalization", () => {
  test("uses the legacy summoner name when the Riot game name is missing", async () => {
    const result = await buildFirstParticipantClassicMatch({
      riotIdGameName: undefined,
      riotIdTagline: "TAG",
      summonerName: "Legacy Summoner",
    });

    expect(result.players[0]?.champion.riotIdGameName).toBe("Legacy Summoner");
    expect(result.players[0]?.champion.riotIdTagLine).toBe("TAG");
  });

  test("uses an explicit placeholder when the Riot tagline is empty", async () => {
    const result = await buildFirstParticipantClassicMatch({
      riotIdGameName: "Complete Name",
      riotIdTagline: "",
      summonerName: "Legacy Summoner",
    });

    expect(result.players[0]?.champion.riotIdGameName).toBe("Complete Name");
    expect(result.players[0]?.champion.riotIdTagLine).toBe("Unknown");
  });

  test("uses explicit placeholders when every participant name is unavailable", async () => {
    const result = await buildFirstParticipantClassicMatch({
      riotIdGameName: undefined,
      riotIdTagline: "",
      summonerName: "",
    });

    expect(result.players[0]?.champion.riotIdGameName).toBe("Unknown");
    expect(result.players[0]?.champion.riotIdTagLine).toBe("Unknown");
  });

  test("preserves complete Riot IDs", async () => {
    const result = await buildFirstParticipantClassicMatch({
      riotIdGameName: "Riot Name",
      riotIdTagline: "R1OT",
      summonerName: "Legacy Summoner",
    });

    expect(result.players[0]?.champion.riotIdGameName).toBe("Riot Name");
    expect(result.players[0]?.champion.riotIdTagLine).toBe("R1OT");
  });
});

describe("buildClassicMatch", () => {
  test.each([
    [4310, "CLASSIC", "Classic Rift"],
    [2450, "CLASSIC ARAM MAYHEM", "The Bandlewood"],
    [3280, "CLASSIC ARAM MAYHEM", "The Bandlewood"],
    [2450, "KIWI_JADE", "The Bandlewood"],
  ] as const)(
    "builds the %s Classic report model for %s",
    async (queueId, gameMode, mapName) => {
      const rawMatch = await classicMatchFixture({
        queueId,
        gameMode,
        mapId: mapName === "Classic Rift" ? 453 : 35,
      });
      const trackedParticipant = rawMatch.info.participants[0];
      if (trackedParticipant === undefined) {
        throw new Error("Classic fixture is missing its tracked participant");
      }
      const trackedPlayer = PlayerConfigEntrySchema.parse({
        alias: "Scout Classic",
        league: {
          leagueAccount: {
            puuid: trackedParticipant.puuid,
            region: "AMERICA_NORTH",
          },
        },
      });

      const result = buildClassicMatch(rawMatch, [trackedPlayer]);
      if (result === undefined) {
        throw new Error(
          "Classic match unexpectedly omitted its tracked player",
        );
      }

      expect(result.queueType).toBe(
        mapName === "Classic Rift" ? "classic" : "classic aram mayhem",
      );
      expect(result.mapName).toBe(mapName);
      expect(result.teams.blue[0]?.championName).toStartWith("Jade_");
      expect(result.teams.blue[0]?.spells).toEqual([74, 714]);
    },
  );

  test("accepts Riot modern IDs and the real Classic ARAM Mayhem map ID", async () => {
    const rawMatch = await classicMatchFixture({
      queueId: 2450,
      gameMode: "KIWI_JADE",
      mapId: 12,
    });
    const modernChampionIds = [103, 12, 32, 34, 1, 22, 53, 63, 31, 42];
    const modernMatch = RawMatchSchema.parse({
      ...rawMatch,
      info: {
        ...rawMatch.info,
        participants: rawMatch.info.participants.map((participant, index) => ({
          ...participant,
          championId: modernChampionIds[index],
          summoner1Id: 4,
          summoner2Id: 32,
        })),
      },
    });
    const trackedParticipant = modernMatch.info.participants[0];
    if (trackedParticipant === undefined) {
      throw new Error("Classic match is missing its tracked participant");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Scout Classic",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    const result = buildClassicMatch(modernMatch, [trackedPlayer]);

    expect(result?.queueType).toBe("classic aram mayhem");
    expect(result?.mapName).toBe("The Bandlewood");
    expect(result?.teams.blue[0]?.championId).toBe(60_103);
    expect(result?.teams.blue[0]?.spells).toEqual([74, 32]);
  });

  test("builds and renders the captured production S3 Classic ARAM Mayhem match", async () => {
    // Captured from scout-prod/games/2026/07/29/BR1_3267199656/match.json.
    const input: unknown = await Bun.file(realS3FixtureUrl).json();
    const rawMatch = RawMatchSchema.parse(input);
    const trackedParticipant = rawMatch.info.participants[0];
    if (trackedParticipant === undefined) {
      throw new Error("Real Classic ARAM Mayhem fixture has no participants");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Real Classic ARAM",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    expect(rawMatch.metadata.matchId).toBe("BR1_3267199656");
    expect(rawMatch.info.queueId).toBe(2450);
    expect(rawMatch.info.gameMode).toBe("KIWI_JADE");
    expect(rawMatch.info.mapId).toBe(12);
    expect(rawMatch.info.gameModeMutators).toEqual(["mapskin_map12_jade"]);

    const result = buildClassicMatch(rawMatch, [trackedPlayer]);
    if (result === undefined) {
      throw new Error("Real Classic ARAM Mayhem match omitted its player");
    }

    expect(result.queueType).toBe("classic aram mayhem");
    expect(result.mapName).toBe("The Bandlewood");
    expect(result.teams.blue[0]?.championName).toBe("Jade_Pantheon");
    expect(result.teams.blue[0]?.spells).toEqual([74, 32]);

    const [svg, repeatSvg, png] = await Promise.all([
      classicMatchToSvg(result),
      classicMatchToSvg(result),
      classicMatchToImage(result),
    ]);
    expect(svg).toBe(repeatSvg);
    expect(svg).toContain('width="1920" height="1200"');
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });
});

describe("buildClassicMatch roster handling", () => {
  test("groups full rosters by team ID and keeps the narrow Classic model", async () => {
    const rawMatch = await classicMatchFixture();
    const trackedParticipant = rawMatch.info.participants[6];
    if (trackedParticipant === undefined) {
      throw new Error("Classic fixture is missing its tracked participant");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Scout Classic",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    const result = buildClassicMatch(rawMatch, [trackedPlayer]);
    if (result === undefined) {
      throw new Error("Classic match unexpectedly omitted its tracked player");
    }

    expect(result.queueType).toBe("classic");
    expect(result.mapName).toBe("Classic Rift");
    expect(result.teams.blue).toHaveLength(5);
    expect(result.teams.red).toHaveLength(5);
    expect(result.players[0]?.team).toBe("red");
    expect(result.players[0]?.champion.puuid).toBe(trackedParticipant.puuid);
    expect(result.teams.red[1]?.championName).toBe("Jade_Blitzcrank");
    expect(result.teams.red[1]?.spells).toEqual([74, 714]);
    expect("runes" in (result.teams.red[1] ?? {})).toBe(false);
    expect("rankBeforeMatch" in (result.players[0] ?? {})).toBe(false);
  });

  test("preserves partial custom-team sizes instead of slicing", async () => {
    const rawMatch = await classicMatchFixture();
    const partial = RawMatchSchema.parse({
      ...rawMatch,
      metadata: {
        ...rawMatch.metadata,
        participants: rawMatch.metadata.participants.slice(0, 5),
      },
      info: {
        ...rawMatch.info,
        participants: [
          ...rawMatch.info.participants.slice(0, 3),
          ...rawMatch.info.participants.slice(5, 7),
        ],
      },
    });
    const trackedParticipant = partial.info.participants[0];
    if (trackedParticipant === undefined) {
      throw new Error("Partial Classic fixture has no participants");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Partial Classic",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    const result = buildClassicMatch(partial, [trackedPlayer]);
    if (result === undefined) {
      throw new Error("Partial Classic match unexpectedly omitted its player");
    }

    expect(result.teams.blue).toHaveLength(3);
    expect(result.teams.red).toHaveLength(2);
  });

  test("skips metadata-only tracked participants while retaining present players", async () => {
    const rawMatch = await classicMatchFixture();
    const presentParticipant = rawMatch.info.participants[0];
    const missingParticipant = rawMatch.info.participants[1];
    if (presentParticipant === undefined || missingParticipant === undefined) {
      throw new Error("Classic fixture is missing mismatch test participants");
    }
    const mismatch = RawMatchSchema.parse({
      ...rawMatch,
      info: {
        ...rawMatch.info,
        participants: rawMatch.info.participants.filter(
          (participant) => participant.puuid !== missingParticipant.puuid,
        ),
      },
    });
    const presentPlayer = PlayerConfigEntrySchema.parse({
      alias: "Present Classic",
      league: {
        leagueAccount: {
          puuid: presentParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });
    const missingPlayer = PlayerConfigEntrySchema.parse({
      alias: "Metadata-only Classic",
      league: {
        leagueAccount: {
          puuid: missingParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    const result = buildClassicMatch(mismatch, [presentPlayer, missingPlayer]);
    if (result === undefined) {
      throw new Error("Classic match omitted its remaining tracked player");
    }

    expect(result.players).toHaveLength(1);
    expect(result.players[0]?.playerConfig.alias).toBe("Present Classic");
  });

  test("returns no report model when every tracked participant is metadata-only", async () => {
    const rawMatch = await classicMatchFixture();
    const missingParticipant = rawMatch.info.participants[0];
    if (missingParticipant === undefined) {
      throw new Error("Classic fixture is missing a mismatch test participant");
    }
    const mismatch = RawMatchSchema.parse({
      ...rawMatch,
      info: {
        ...rawMatch.info,
        participants: rawMatch.info.participants.filter(
          (participant) => participant.puuid !== missingParticipant.puuid,
        ),
      },
    });
    const missingPlayer = PlayerConfigEntrySchema.parse({
      alias: "Metadata-only Classic",
      league: {
        leagueAccount: {
          puuid: missingParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });

    expect(buildClassicMatch(mismatch, [missingPlayer])).toBeUndefined();
  });
});

describe("generateMatchReport Classic routing", () => {
  test("routes before rank, timeline, history, and AI dependencies", async () => {
    const rawMatch = await classicMatchFixture();
    const trackedParticipant = rawMatch.info.participants[0];
    if (trackedParticipant === undefined) {
      throw new Error("Classic fixture is missing its tracked participant");
    }
    const trackedPlayer = PlayerConfigEntrySchema.parse({
      alias: "Dependency Spy",
      league: {
        leagueAccount: {
          puuid: trackedParticipant.puuid,
          region: "AMERICA_NORTH",
        },
      },
    });
    const processClassicMatchSpy = mock(async () => ({
      content: "Classic dependency route",
    }));
    const getPlayerSpy = mock(async () => {
      throw new Error("Classic must not fetch ranked player data");
    });
    const fetchTimelineSpy = mock(async () => {
      throw new Error("Classic must not fetch timeline data");
    });
    const processArenaSpy = mock(async () => {
      throw new Error("Classic must not enter arena processing");
    });
    const processStandardSpy = mock(async () => {
      throw new Error(
        "Classic must not enter rank-history or AI standard processing",
      );
    });

    const result = await generateMatchReport(
      rawMatch,
      [trackedPlayer],
      { targetGuildIds: [] },
      {
        processClassicMatch: processClassicMatchSpy,
        getPlayer: getPlayerSpy,
        fetchTimelineIfStandardMatch: fetchTimelineSpy,
        processArenaMatch: processArenaSpy,
        processStandardMatch: processStandardSpy,
      },
    );

    expect(result?.content).toBe("Classic dependency route");
    expect(processClassicMatchSpy).toHaveBeenCalledTimes(1);
    expect(getPlayerSpy).toHaveBeenCalledTimes(0);
    expect(fetchTimelineSpy).toHaveBeenCalledTimes(0);
    expect(processArenaSpy).toHaveBeenCalledTimes(0);
    expect(processStandardSpy).toHaveBeenCalledTimes(0);
  });
});
