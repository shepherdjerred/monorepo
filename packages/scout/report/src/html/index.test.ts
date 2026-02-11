import { type CompletedMatch, DiscordAccountIdSchema, LeaguePuuidSchema } from "@shepherdjerred/scout-data";
import { matchToSvg, svgToPng } from "@shepherdjerred/scout-report/html/index.tsx";
import { test, expect } from "bun:test";

function hashSvg(svg: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(svg);
  return hasher.digest("hex");
}

function createChampion(params: {
  riotIdGameName: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  items: number[];
  spells: number[];
  lane?: "top" | "jungle" | "middle" | "adc" | "support";
  creepScore: number;
  visionScore: number;
  damage: number;
  gold: number;
  level: number;
}) {
  return {
    riotIdGameName: params.riotIdGameName,
    championName: params.championName,
    kills: params.kills,
    deaths: params.deaths,
    assists: params.assists,
    items: params.items,
    spells: params.spells,
    runes: [
      // Keystone + 3 primary runes (Dark Harvest + domination tree)
      { id: 8128, name: "Dark Harvest", description: "Damaging a champion below 50% health deals adaptive damage" },
      { id: 8126, name: "Cheap Shot", description: "Deal bonus true damage to champions with impaired movement" },
      { id: 8138, name: "Eyeball Collection", description: "Collect eyeballs for champion takedowns" },
      { id: 8135, name: "Treasure Hunter", description: "Gain gold for unique champion takedowns" },
      // 2 secondary runes (from another tree)
      { id: 8345, name: "Biscuit Delivery", description: "Gain a biscuit every 2 min" },
      { id: 8347, name: "Cosmic Insight", description: "Gain CDR for summoner spells and items" },
    ],
    lane: params.lane,
    creepScore: params.creepScore,
    visionScore: params.visionScore,
    damage: params.damage,
    gold: params.gold,
    level: params.level,
  };
}

function getBlueTeam() {
  return [
    createChampion({
      riotIdGameName: "Mr Spaghetti",
      championName: "Aatrox",
      kills: 8,
      deaths: 9,
      assists: 4,
      items: [1031, 0, 3047, 3814, 6691, 6694, 3364],
      spells: [4, 12],
      lane: "top",
      creepScore: 180,
      visionScore: 19,
      damage: 18645,
      gold: 12053,
      level: 16,
    }),
    createChampion({
      riotIdGameName: "zainji",
      championName: "Nocturne",
      kills: 9,
      deaths: 8,
      assists: 10,
      items: [1031, 6631, 3133, 3156, 3047, 3071, 3363],
      spells: [4, 11],
      lane: "jungle",
      creepScore: 188,
      visionScore: 21,
      damage: 22737,
      gold: 13930,
      level: 15,
    }),
    createChampion({
      riotIdGameName: "Neeeeeeelson",
      championName: "Akali",
      kills: 8,
      deaths: 2,
      assists: 11,
      items: [3089, 3111, 3152, 2055, 1082, 4645, 3364],
      spells: [12, 4],
      lane: "middle",
      creepScore: 215,
      visionScore: 27,
      damage: 23266,
      gold: 12686,
      level: 16,
    }),
    createChampion({
      riotIdGameName: "aaronchou",
      championName: "Zeri",
      kills: 7,
      deaths: 10,
      assists: 9,
      items: [1055, 3006, 3095, 6675, 3046, 3035, 3363],
      spells: [7, 4],
      lane: "adc",
      creepScore: 202,
      visionScore: 16,
      damage: 25720,
      gold: 12583,
      level: 14,
    }),
    createChampion({
      riotIdGameName: "hellorandom",
      championName: "Lulu",
      kills: 1,
      deaths: 4,
      assists: 18,
      items: [3853, 3222, 2055, 3158, 3012, 6620, 3364],
      spells: [14, 4],
      lane: "support",
      creepScore: 23,
      visionScore: 42,
      damage: 8947,
      gold: 7665,
      level: 13,
    }),
  ];
}

function getRedTeam() {
  return [
    createChampion({
      riotIdGameName: "how2smo",
      championName: "Garen",
      kills: 16,
      deaths: 7,
      assists: 1,
      items: [3078, 3181, 3046, 3071, 3035, 3006, 3340],
      spells: [14, 4],
      lane: "top",
      creepScore: 219,
      visionScore: 25,
      damage: 29663,
      gold: 17426,
      level: 18,
    }),
    createChampion({
      riotIdGameName: "Oroulerd",
      championName: "Zac",
      kills: 0,
      deaths: 7,
      assists: 10,
      items: [6665, 2055, 3047, 1033, 3068, 0, 3364],
      spells: [11, 4],
      lane: "jungle",
      creepScore: 134,
      visionScore: 32,
      damage: 10916,
      gold: 9051,
      level: 14,
    }),
    createChampion({
      riotIdGameName: "suggsyman",
      championName: "Viktor",
      kills: 4,
      deaths: 7,
      assists: 4,
      items: [1056, 6653, 3020, 4645, 3135, 0, 3340],
      spells: [12, 4],
      lane: "middle",
      creepScore: 193,
      visionScore: 21,
      damage: 15943,
      gold: 11613,
      level: 15,
    }),
    createChampion({
      riotIdGameName: "zombie villager",
      championName: "Yasuo",
      kills: 9,
      deaths: 7,
      assists: 8,
      items: [3026, 3031, 0, 6672, 6673, 3006, 3363],
      spells: [3, 4],
      lane: "adc",
      creepScore: 247,
      visionScore: 23,
      damage: 24510,
      gold: 15965,
      level: 16,
    }),
    createChampion({
      riotIdGameName: "sjerred",
      championName: "Xerath",
      kills: 4,
      deaths: 5,
      assists: 15,
      items: [3853, 4645, 6653, 1052, 3020, 1058, 3364],
      spells: [12, 4],
      lane: "support",
      creepScore: 38,
      visionScore: 67,
      damage: 24395,
      gold: 10759,
      level: 14,
    }),
  ];
}

function getMatch(): CompletedMatch {
  const blueTeam = getBlueTeam();
  const redTeam = getRedTeam();
  const playerChampion = blueTeam[0];
  const laneOpponent = redTeam[0];

  if (!playerChampion || !laneOpponent) {
    throw new Error("Teams must have at least one player");
  }

  return {
    queueType: "solo",
    players: [
      {
        playerConfig: {
          alias: "name",
          league: {
            leagueAccount: {
              puuid: LeaguePuuidSchema.parse(
                "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
              ),
              region: "AMERICA_NORTH",
            },
          },
          discordAccount: {
            id: DiscordAccountIdSchema.parse("12345678901234567"),
          },
        },
        rankBeforeMatch: {
          division: 4,
          tier: "gold",
          lp: 90,
          wins: 10,
          losses: 20,
        },
        rankAfterMatch: {
          division: 3,
          tier: "gold",
          lp: 0,
          wins: 50,
          losses: 30,
        },
        wins: 10,
        losses: 20,
        champion: playerChampion,
        outcome: "Defeat",
        team: "blue",
        lane: "top" as const,
        laneOpponent,
      },
    ],
    durationInSeconds: 1851,
    teams: {
      blue: blueTeam,
      red: redTeam,
    },
  };
}

test("sanity check", async () => {
  const svg = await matchToSvg(getMatch());
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/match.svg", import.meta.url), svg);

  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("no items test", async () => {
  const matchNoItems = getMatch();
  if (matchNoItems.players[0]?.champion) {
    matchNoItems.players[0].champion.items = [0, 0, 0, 0, 0, 0, 0];
  }
  matchNoItems.teams.blue.forEach((player) => (player.items = [0, 0, 0, 0, 0, 0, 0]));
  matchNoItems.teams.red.forEach((player) => (player.items = [0, 0, 0, 0, 0, 0, 0]));

  const svg = await matchToSvg(matchNoItems);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_no_items.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/match_no_items.svg", import.meta.url), svg);

  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("all fields zeroed out test", async () => {
  const matchZeroedOut = getMatch();
  matchZeroedOut.durationInSeconds = 0;
  matchZeroedOut.players.forEach((player) => {
    player.rankBeforeMatch = {
      wins: 0,
      losses: 0,
      tier: "iron",
      division: 4,
      lp: 0,
    };
    player.rankAfterMatch = {
      wins: 0,
      losses: 0,
      tier: "iron",
      division: 4,
      lp: 0,
    };
    player.wins = 0;
    player.losses = 0;

    player.champion.kills = 0;
    player.champion.deaths = 0;
    player.champion.assists = 0;
    player.champion.items = [0, 0, 0, 0, 0, 0, 0];
    player.champion.creepScore = 0;
    player.champion.visionScore = 0;
    player.champion.damage = 0;
    player.champion.gold = 0;
    player.champion.level = 0;
  });
  matchZeroedOut.teams.blue.forEach((player) => {
    player.kills = 0;
    player.deaths = 0;
    player.assists = 0;
    player.items = [0, 0, 0, 0, 0, 0, 0];
    player.creepScore = 0;
    player.visionScore = 0;
    player.damage = 0;
    player.gold = 0;
    player.level = 0;
  });
  matchZeroedOut.teams.red.forEach((player) => {
    player.kills = 0;
    player.deaths = 0;
    player.assists = 0;
    player.items = [0, 0, 0, 0, 0, 0, 0];
    player.creepScore = 0;
    player.visionScore = 0;
    player.damage = 0;
    player.gold = 0;
    player.level = 0;
  });

  const svg = await matchToSvg(matchZeroedOut);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_zeroed_out.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/match_zeroed_out.svg", import.meta.url), svg);
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("no rank test", async () => {
  const matchNoRank = getMatch();
  matchNoRank.players.forEach((player) => {
    player.rankBeforeMatch = undefined;
    player.rankAfterMatch = undefined;
  });

  const svg = await matchToSvg(matchNoRank);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_no_rank.png", import.meta.url), png);

  await Bun.write(new URL("__snapshots__/match_no_rank.svg", import.meta.url), svg);
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("large values test", async () => {
  const matchLargeValues = getMatch();
  matchLargeValues.players.forEach((player) => {
    player.playerConfig.alias = "SummonerName12345";
    player.champion.championName = "Nunu & Willump";
    player.champion.kills = 45;
  });
  matchLargeValues.durationInSeconds = 3660; // 1 hour and 1 minute

  matchLargeValues.teams.blue.forEach((player) => {
    player.riotIdGameName = "SummonerName12345";
    player.championName = "Nunu & Willump";
    player.kills = 45;
    player.deaths = 40;
    player.assists = 50;
    player.items = [3031, 3031, 3031, 3031, 3031, 3031, 3031];
    player.creepScore = 999;
    player.visionScore = 500;
    player.damage = 999999;
    player.gold = 500000;
    player.level = 25;
  });

  matchLargeValues.teams.red.forEach((player) => {
    player.riotIdGameName = "SummonerName12345";
    player.championName = "Nunu & Willump";
    player.kills = 45;
    player.deaths = 0;
    player.assists = 50;
    player.items = [3031, 3031, 3031, 3031, 3031, 3031, 3031];
    player.creepScore = 999;
    player.visionScore = 500;
    player.damage = 999999;
    player.gold = 500000;
    player.level = 25;
  });

  const svg = await matchToSvg(matchLargeValues);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_large_values.png", import.meta.url), png);

  await Bun.write(new URL("__snapshots__/match_large_values.svg", import.meta.url), svg);
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("victory test", async () => {
  const matchVictory = getMatch();
  matchVictory.players.forEach((player) => {
    player.outcome = "Victory";
  });

  const svg = await matchToSvg(matchVictory);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_victory.png", import.meta.url), png);

  await Bun.write(new URL("__snapshots__/match_victory.svg", import.meta.url), svg);
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("surrender test", async () => {
  const matchSurrender = getMatch();
  matchSurrender.players.forEach((player) => {
    player.outcome = "Surrender";
  });

  const svg = await matchToSvg(matchSurrender);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_surrender.png", import.meta.url), png);

  await Bun.write(new URL("__snapshots__/match_surrender.svg", import.meta.url), svg);
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("no rank before match test", async () => {
  const matchNoRankBefore = getMatch();
  matchNoRankBefore.players.forEach((player) => {
    player.rankBeforeMatch = undefined;
    player.rankAfterMatch = {
      wins: 50,
      losses: 30,
      tier: "gold",
      division: 3,
      lp: 0,
    };
  });

  const svg = await matchToSvg(matchNoRankBefore);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_no_rank_before.png", import.meta.url), png);

  await Bun.write(new URL("__snapshots__/match_no_rank_before.svg", import.meta.url), svg);
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("multiple highlighted players test", async () => {
  const match: CompletedMatch = getMatch();
  // Add a second highlighted player
  match.players.push({
    playerConfig: {
      alias: "second player",
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(
            "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDa9biieJ5ZRD049AUCBjLjyBeeezTaw",
          ),
          region: "AMERICA_NORTH",
        },
      },
      discordAccount: {
        id: DiscordAccountIdSchema.parse("98765432109876543"),
      },
    },
    rankBeforeMatch: {
      division: 2,
      tier: "silver",
      lp: 50,
      wins: 20,
      losses: 10,
    },
    rankAfterMatch: {
      division: 1,
      tier: "silver",
      lp: 0,
      wins: 25,
      losses: 12,
    },
    wins: 20,
    losses: 10,
    champion: {
      riotIdGameName: "Mr Spaghetti",
      championName: "Aatrox",
      kills: 5,
      deaths: 2,
      assists: 15,
      items: [1056, 3285, 3020, 3165, 3102, 3089, 3363],
      spells: [4, 7],
      runes: [],
      lane: "middle",
      creepScore: 210,
      visionScore: 25,
      damage: 22000,
      gold: 13000,
      level: 17,
    },
    outcome: "Victory",
    team: "blue",
    lane: "middle",
    laneOpponent: {
      riotIdGameName: "enemy mid",
      championName: "Zed",
      kills: 7,
      deaths: 7,
      assists: 7,
      items: [3142, 6692, 3158, 3071, 3814, 6694, 3364],
      spells: [4, 14],
      runes: [],
      lane: "middle",
      creepScore: 185,
      visionScore: 15,
      damage: 18000,
      gold: 12000,
      level: 16,
    },
  });

  const svg = await matchToSvg(match);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_multiple_highlighted_players.png", import.meta.url), png);

  await Bun.write(new URL("__snapshots__/match_multiple_highlighted_players.svg", import.meta.url), svg);
  // Hash the SVG for snapshot comparison instead of storing the full content
  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("clash game test", async () => {
  const matchClash = getMatch();
  matchClash.queueType = "clash";

  const svg = await matchToSvg(matchClash);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_clash.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/match_clash.svg", import.meta.url), svg);

  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("aram clash game test", async () => {
  const matchAramClash = getMatch();
  matchAramClash.queueType = "aram clash";

  const svg = await matchToSvg(matchAramClash);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_aram_clash.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/match_aram_clash.svg", import.meta.url), svg);

  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});

test("multiple players with promotion and demotion test", async () => {
  const match: CompletedMatch = getMatch();

  // First player (top) - PROMOTED from Gold 4 to Gold 3
  match.players[0]!.rankBeforeMatch = {
    division: 4,
    tier: "gold",
    lp: 90,
    wins: 10,
    losses: 20,
  };
  match.players[0]!.rankAfterMatch = {
    division: 3,
    tier: "gold",
    lp: 0,
    wins: 11,
    losses: 20,
  };
  match.players[0]!.outcome = "Victory";

  // Second player (jungle) - DEMOTED from Platinum 4 to Gold 1
  match.players.push({
    playerConfig: {
      alias: "jungler",
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(
            "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
          ),
          region: "AMERICA_NORTH",
        },
      },
      discordAccount: {
        id: DiscordAccountIdSchema.parse("98765432109876543"),
      },
    },
    rankBeforeMatch: {
      division: 4,
      tier: "platinum",
      lp: 0,
      wins: 30,
      losses: 35,
    },
    rankAfterMatch: {
      division: 1,
      tier: "gold",
      lp: 75,
      wins: 30,
      losses: 36,
    },
    wins: 30,
    losses: 35,
    champion: {
      riotIdGameName: "zainji",
      championName: "Nocturne",
      kills: 9,
      deaths: 8,
      assists: 10,
      items: [1031, 6631, 3133, 3156, 3047, 3071, 3363],
      spells: [4, 11],
      runes: [],
      lane: "jungle",
      creepScore: 188,
      visionScore: 21,
      damage: 22737,
      gold: 13930,
      level: 15,
    },
    outcome: "Defeat",
    team: "blue",
    lane: "jungle",
    laneOpponent: {
      riotIdGameName: "Oroulerd",
      championName: "Zac",
      kills: 0,
      deaths: 7,
      assists: 10,
      items: [6665, 2055, 3047, 1033, 3068, 0, 3364],
      spells: [11, 4],
      runes: [],
      lane: "jungle",
      creepScore: 134,
      visionScore: 32,
      damage: 10916,
      gold: 9051,
      level: 14,
    },
  });

  // Third player (mid) - no rank before (first tracked game in this queue)
  match.players.push({
    playerConfig: {
      alias: "midlaner",
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(
            "YtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
          ),
          region: "AMERICA_NORTH",
        },
      },
      discordAccount: {
        id: DiscordAccountIdSchema.parse("11111111111111111"),
      },
    },
    rankBeforeMatch: undefined,
    rankAfterMatch: {
      division: 3,
      tier: "silver",
      lp: 0,
      wins: 5,
      losses: 5,
    },
    wins: 5,
    losses: 5,
    champion: {
      riotIdGameName: "Neeeeeeelson",
      championName: "Akali",
      kills: 8,
      deaths: 2,
      assists: 11,
      items: [3089, 3111, 3152, 2055, 1082, 4645, 3364],
      spells: [12, 4],
      runes: [],
      lane: "middle",
      creepScore: 215,
      visionScore: 27,
      damage: 23266,
      gold: 12686,
      level: 16,
    },
    outcome: "Victory",
    team: "blue",
    lane: "middle",
    laneOpponent: {
      riotIdGameName: "suggsyman",
      championName: "Viktor",
      kills: 4,
      deaths: 7,
      assists: 4,
      items: [1056, 6653, 3020, 4645, 3135, 0, 3340],
      spells: [12, 4],
      runes: [],
      lane: "middle",
      creepScore: 193,
      visionScore: 21,
      damage: 15943,
      gold: 11613,
      level: 15,
    },
  });

  const svg = await matchToSvg(match);
  const png = await svgToPng(svg);
  await Bun.write(new URL("__snapshots__/match_promotion_demotion_mixed.png", import.meta.url), png);
  await Bun.write(new URL("__snapshots__/match_promotion_demotion_mixed.svg", import.meta.url), svg);

  const svgHash = hashSvg(svg);
  expect(svgHash).toMatchSnapshot();
});
