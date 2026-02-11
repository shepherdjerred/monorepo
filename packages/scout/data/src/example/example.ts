import { type CompletedMatch, type ArenaMatch, LeaguePuuidSchema, DiscordAccountIdSchema } from "@shepherdjerred/scout-data";
import { getArenaExampleMatch } from "./arena-example.ts";

type MatchType = "ranked" | "unranked" | "aram" | "arena";

export type AnyMatch = CompletedMatch | ArenaMatch;

function getBaseMatch(): CompletedMatch {
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
        champion: {
          riotIdGameName: "zombie villager",
          championName: "Aatrox",
          kills: 8,
          deaths: 9,
          assists: 4,
          items: [1031, 0, 3047, 3814, 6691, 6694, 3364],
          spells: [4, 12],
          runes: [],
          lane: "top",
          creepScore: 180,
          visionScore: 19,
          damage: 18645,
          gold: 12053,
          level: 16,
        },
        outcome: "Defeat",
        team: "blue",
        lane: "top",
        laneOpponent: {
          riotIdGameName: "CPHS WARRIOR",
          championName: "Garen",
          kills: 16,
          deaths: 7,
          assists: 1,
          items: [3078, 3181, 3046, 3071, 3035, 3006, 3340],
          spells: [14, 4],
          runes: [],
          lane: "top",
          creepScore: 219,
          visionScore: 25,
          damage: 29663,
          gold: 17426,
          level: 18,
        },
      },
    ],
    durationInSeconds: 1851,
    teams: {
      blue: [
        {
          riotIdGameName: "Mr Spaghetti",
          championName: "Aatrox",
          kills: 8,
          deaths: 9,
          assists: 4,
          items: [1031, 0, 3047, 3814, 6691, 6694, 3364],
          spells: [4, 12],
          runes: [],
          lane: "top",
          creepScore: 180,
          visionScore: 19,
          damage: 18645,
          gold: 12053,
          level: 16,
        },
        {
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
        {
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
        {
          riotIdGameName: "aaronchou",
          championName: "Zeri",
          kills: 7,
          deaths: 10,
          assists: 9,
          items: [1055, 3006, 3095, 6675, 3046, 3035, 3363],
          spells: [7, 4],
          runes: [],
          lane: "adc",
          creepScore: 202,
          visionScore: 16,
          damage: 25720,
          gold: 12583,
          level: 14,
        },
        {
          riotIdGameName: "hellorandom",
          championName: "Lulu",
          kills: 1,
          deaths: 4,
          assists: 18,
          items: [3853, 3222, 2055, 3158, 3012, 6620, 3364],
          spells: [14, 4],
          runes: [],
          lane: "support",
          creepScore: 23,
          visionScore: 42,
          damage: 8947,
          gold: 7665,
          level: 13,
        },
      ],
      red: [
        {
          riotIdGameName: "how2smo",
          championName: "Garen",
          kills: 16,
          deaths: 7,
          assists: 1,
          items: [3078, 3181, 3046, 3071, 3035, 3006, 3340],
          spells: [14, 4],
          runes: [],
          lane: "top",
          creepScore: 219,
          visionScore: 25,
          damage: 29663,
          gold: 17426,
          level: 18,
        },
        {
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
        {
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
        {
          riotIdGameName: "zombie villager",
          championName: "Yasuo",
          kills: 9,
          deaths: 7,
          assists: 8,
          items: [3026, 3031, 0, 6672, 6673, 3006, 3363],
          spells: [3, 4],
          runes: [],
          lane: "adc",
          creepScore: 247,
          visionScore: 23,
          damage: 24510,
          gold: 15965,
          level: 16,
        },
        {
          riotIdGameName: "sjerred",
          championName: "Xerath",
          kills: 4,
          deaths: 5,
          assists: 15,
          items: [3853, 4645, 6653, 1052, 3020, 1058, 3364],
          spells: [12, 4],
          runes: [],
          lane: "support",
          creepScore: 38,
          visionScore: 67,
          damage: 24395,
          gold: 10759,
          level: 14,
        },
      ],
    },
  };
}

export function getExampleMatch(matchType: MatchType = "ranked"): AnyMatch {
  const base = getBaseMatch();

  switch (matchType) {
    case "ranked":
      return { ...base, queueType: "solo" };

    case "unranked":
      return { ...base, queueType: "draft pick" };

    case "aram": {
      // ARAM: everyone plays in middle lane
      return {
        ...base,
        queueType: "aram",
        players: base.players.map((p) => ({
          ...p,
          lane: "middle",
          laneOpponent: p.laneOpponent ? { ...p.laneOpponent, lane: "middle" } : undefined,
        })),
        teams: {
          blue: base.teams.blue.map((p) => ({ ...p, lane: "middle" })),
          red: base.teams.red.map((p) => ({ ...p, lane: "middle" })),
        },
      };
    }

    case "arena": {
      return getArenaExampleMatch();
    }

    default: {
      const _exhaustive: never = matchType;
      return _exhaustive;
    }
  }
}
