import {
  type CompletedMatch,
  DiscordAccountIdSchema,
  LeaguePuuidSchema,
  type Rank,
  type Rune,
} from "@scout-for-lol/data";

const NO_RUNES: Rune[] = [];

function champion(params: {
  riotIdGameName: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  items?: number[];
  lane?: "top" | "jungle" | "middle" | "adc" | "support";
  damage?: number;
  creepScore?: number;
  level?: number;
}) {
  return {
    riotIdGameName: params.riotIdGameName,
    championName: params.championName,
    kills: params.kills,
    deaths: params.deaths,
    assists: params.assists,
    items: params.items ?? [3078, 3181, 3047, 3071, 3035, 3006, 3364],
    spells: [4, 11],
    runes: NO_RUNES,
    lane: params.lane,
    creepScore: params.creepScore ?? 180,
    visionScore: 25,
    damage: params.damage ?? 20_000,
    gold: 13_000,
    level: params.level ?? 17,
  };
}

const DIAMOND_BEFORE: Rank = {
  division: 2,
  tier: "diamond",
  lp: 38,
  wins: 60,
  losses: 50,
};

const DIAMOND_AFTER: Rank = {
  division: 2,
  tier: "diamond",
  lp: 60,
  wins: 61,
  losses: 50,
};

function trackedPlayer(params: {
  alias: string;
  puuid: string;
  discordId: string;
  outcome: "Victory" | "Defeat" | "Surrender";
  team: "blue" | "red";
  lane: "top" | "jungle" | "middle" | "adc" | "support" | undefined;
  champion: ReturnType<typeof champion>;
  rankBefore?: Rank;
  rankAfter?: Rank;
}) {
  return {
    playerConfig: {
      alias: params.alias,
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(params.puuid),
          region: "AMERICA_NORTH" as const,
        },
      },
      discordAccount: {
        id: DiscordAccountIdSchema.parse(params.discordId),
      },
    },
    rankBeforeMatch: params.rankBefore ?? DIAMOND_BEFORE,
    rankAfterMatch: params.rankAfter ?? DIAMOND_AFTER,
    wins: 61,
    losses: 50,
    champion: params.champion,
    outcome: params.outcome,
    team: params.team,
    lane: params.lane,
  };
}

function blueTeam() {
  return [
    champion({
      riotIdGameName: "sjerred",
      championName: "Warwick",
      kills: 5,
      deaths: 15,
      assists: 6,
      lane: "top",
      damage: 20_900,
      creepScore: 185,
    }),
    champion({
      riotIdGameName: "Snipzar",
      championName: "Senna",
      kills: 16,
      deaths: 6,
      assists: 28,
      lane: "support",
      damage: 32_400,
      creepScore: 42,
    }),
    champion({
      riotIdGameName: "ZynZhao",
      championName: "Galio",
      kills: 9,
      deaths: 7,
      assists: 26,
      lane: "middle",
      damage: 18_900,
      creepScore: 192,
    }),
    champion({
      riotIdGameName: "lolop",
      championName: "MasterYi",
      kills: 19,
      deaths: 7,
      assists: 12,
      lane: "jungle",
      damage: 36_500,
      creepScore: 210,
    }),
    champion({
      riotIdGameName: "Virmel",
      championName: "Caitlyn",
      kills: 16,
      deaths: 8,
      assists: 14,
      lane: "adc",
      damage: 41_300,
      creepScore: 248,
    }),
  ];
}

function redTeam() {
  return [
    champion({
      riotIdGameName: "Enemy Top",
      championName: "Garen",
      kills: 7,
      deaths: 8,
      assists: 4,
      lane: "top",
    }),
    champion({
      riotIdGameName: "Enemy JG",
      championName: "Zac",
      kills: 8,
      deaths: 9,
      assists: 9,
      lane: "jungle",
    }),
    champion({
      riotIdGameName: "Enemy Mid",
      championName: "Viktor",
      kills: 11,
      deaths: 7,
      assists: 6,
      lane: "middle",
    }),
    champion({
      riotIdGameName: "Enemy ADC",
      championName: "Yasuo",
      kills: 12,
      deaths: 9,
      assists: 7,
      lane: "adc",
    }),
    champion({
      riotIdGameName: "Enemy Sup",
      championName: "Xerath",
      kills: 4,
      deaths: 10,
      assists: 17,
      lane: "support",
    }),
  ];
}

// PUUIDs are 78-char strings (LeaguePuuidSchema requires min/max 78). These
// are low-entropy fakes built from a single letter so the lint
// no-secrets/no-secrets rule doesn't flag them.
const PUUIDS = [
  `tracked_player_0_fixture_${"a".repeat(53)}`,
  `tracked_player_1_fixture_${"b".repeat(53)}`,
  `tracked_player_2_fixture_${"c".repeat(53)}`,
  `tracked_player_3_fixture_${"d".repeat(53)}`,
  `tracked_player_4_fixture_${"e".repeat(53)}`,
  `tracked_player_5_fixture_${"f".repeat(53)}`,
  `tracked_player_6_fixture_${"g".repeat(53)}`,
  `tracked_player_7_fixture_${"h".repeat(53)}`,
  `tracked_player_8_fixture_${"i".repeat(53)}`,
  `tracked_player_9_fixture_${"j".repeat(53)}`,
];

const DISCORD_IDS = [
  "10000000000000001",
  "10000000000000002",
  "10000000000000003",
  "10000000000000004",
  "10000000000000005",
  "10000000000000006",
  "10000000000000007",
  "10000000000000008",
  "10000000000000009",
  "10000000000000010",
];

export type RankedFixtureOptions = {
  queueType: "solo" | "flex";
  trackedCount: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  outcome: "Victory" | "Defeat";
  commentary?: string;
};

export function rankedFixture(options: RankedFixtureOptions): CompletedMatch {
  const blue = blueTeam();
  const red = redTeam();
  const champions = [...blue, ...red];

  // The first five tracked players are on blue; tracked players 6–10 are on
  // red and therefore receive the opposite outcome. The hero remains the
  // first blue player, so the report title follows the requested outcome.
  const players = Array.from({ length: options.trackedCount }, (_, i) => {
    const playerChampion = champions[i];
    if (!playerChampion)
      throw new Error(`No champion at index ${i.toString()}`);
    const puuid = PUUIDS[i];
    const discordId = DISCORD_IDS[i];
    if (puuid === undefined || discordId === undefined)
      throw new Error(
        `Missing fixture puuid/discord id for index ${i.toString()}`,
      );
    const isBluePlayer = i < blue.length;
    return trackedPlayer({
      alias: playerChampion.riotIdGameName,
      puuid,
      discordId,
      outcome: isBluePlayer
        ? options.outcome
        : options.outcome === "Victory"
          ? "Defeat"
          : "Victory",
      team: isBluePlayer ? "blue" : "red",
      lane: playerChampion.lane,
      champion: playerChampion,
    });
  });

  return {
    queueType: options.queueType,
    durationInSeconds: 37 * 60 + 23,
    players,
    teams: { blue, red },
    commentary: options.commentary,
  };
}
