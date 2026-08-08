import {
  ClassicMatchSchema,
  GameIdSchema,
  LoadingScreenDataSchema,
  PlayerConfigEntrySchema,
  QueueDisplayNameSchema,
  type ClassicMatch,
  type ClassicLoadingScreenData,
} from "@scout-for-lol/data";

const champions = [
  { id: 60_103, name: "Jade_Ahri" },
  { id: 60_012, name: "Jade_Alistar" },
  { id: 60_032, name: "Jade_Amumu" },
  { id: 60_034, name: "Jade_Anivia" },
  { id: 60_001, name: "Jade_Annie" },
  { id: 60_022, name: "Jade_Ashe" },
  { id: 60_053, name: "Jade_Blitzcrank" },
  { id: 60_063, name: "Jade_Brand" },
  { id: 60_031, name: "Jade_Chogath" },
  { id: 60_042, name: "Jade_Corki" },
] as const;

type ClassicQueueType = ClassicLoadingScreenData["queueType"];

function classicMapName(
  queueType: ClassicQueueType,
): "Classic Rift" | "The Bandlewood" {
  return queueType === "classic" ? "Classic Rift" : "The Bandlewood";
}

function fixturePuuid(index: number): string {
  return `classic-${index.toString().padStart(2, "0")}`.padEnd(78, "x");
}

export function classicLoadingScreenFixture(
  blueCount = 5,
  redCount = 5,
  queueType: ClassicQueueType = "classic",
): ClassicLoadingScreenData {
  const participants = champions
    .map((champion, index) => ({
      puuid: fixturePuuid(index),
      summonerName: `Classic Player ${(index + 1).toString()}#JDE`,
      championId: champion.id,
      championName: champion.name,
      championDisplayName: champion.name.replace("Jade_", ""),
      team: index < 5 ? ("blue" as const) : ("red" as const),
      spell1Id: 74,
      spell2Id: 714,
      isTrackedPlayer: index === 0 || index === 5,
    }))
    .filter(
      (participant) =>
        (participant.team === "blue" &&
          Number(participant.puuid.slice(8, 10)) < blueCount) ||
        (participant.team === "red" &&
          Number(participant.puuid.slice(8, 10)) < 5 + redCount),
    );
  const parsed = LoadingScreenDataSchema.parse({
    gameId: GameIdSchema.parse(7_933_730_085),
    queueType,
    queueDisplayName: QueueDisplayNameSchema.parse(
      queueType === "classic" ? "League Classic" : "ARAM: Mayhem Classic-ish",
    ),
    layout: "classic",
    mapName: classicMapName(queueType),
    participants,
    gameStartTime: 1_775_000_000_000,
  });
  if (parsed.layout !== "classic") {
    throw new Error("Classic loading screen fixture parsed to another layout");
  }
  return parsed;
}

export function classicMatchFixture(
  blueCount = 5,
  redCount = 5,
  outcome: ClassicMatch["players"][number]["outcome"] = "Victory",
  options: {
    heroGameName?: string;
    queueType?: ClassicQueueType;
  } = {},
): ClassicMatch {
  const heroGameName = options.heroGameName ?? "Classic Player 1";
  const queueType = options.queueType ?? "classic";
  const roster = champions.map((champion, index) => ({
    puuid: fixturePuuid(index),
    riotIdGameName:
      index === 0 ? heroGameName : `Classic Player ${(index + 1).toString()}`,
    riotIdTagLine: "JDE",
    championId: champion.id,
    championName: champion.name,
    kills: (index + 2) % 8,
    deaths: (index + 1) % 6,
    assists: (index + 5) % 12,
    level: 12 + (index % 6),
    items: [771_001, 771_004, 771_006, 771_011, 771_018, 771_026, 0],
    spells: [74, 714],
    gold: 8400 + index * 730,
    creepScore: 94 + index * 17,
  }));
  const playerConfig = PlayerConfigEntrySchema.parse({
    alias: "Scout Classic",
    league: {
      leagueAccount: {
        puuid: fixturePuuid(0),
        region: "AMERICA_NORTH",
      },
    },
  });
  const hero = roster[0];
  if (hero === undefined) {
    throw new Error("Classic report fixture has no hero");
  }
  return ClassicMatchSchema.parse({
    durationInSeconds: 2147,
    queueType,
    mapName: classicMapName(queueType),
    players: [
      {
        playerConfig,
        outcome,
        champion: hero,
        team: "blue",
      },
    ],
    teams: {
      blue: roster.slice(0, blueCount),
      red: roster.slice(5, 5 + redCount),
    },
  });
}
