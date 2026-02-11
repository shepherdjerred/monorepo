import {
  type ArenaMatch,
  type ArenaMatchPlayer,
  ArenaMatchPlayerSchema,
  ArenaMatchSchema,
  ArenaTeamSchema,
  LeaguePuuidSchema,
} from "@shepherdjerred/scout-data";
import { getTeams } from "./arena-teams.ts";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";
import { createMasterOfDualityAugment, createCourageAugment } from "./arena-augments.ts";

function getMainPlayer() {
  return {
    playerConfig: {
      alias: "MainPlayer",
      league: {
        leagueAccount: {
          puuid: LeaguePuuidSchema.parse(
            "XtEsV464OFaO3c0_q9REa6wYF0HpC2LK4laLnyM7WhfAVeuDz9biieJ5ZRD049AUCBjLjyBeeezTaw",
          ),
          region: "AMERICA_NORTH" as const,
        },
      },
      discordAccount: null,
    },
    wins: 5,
    losses: 2,
    placement: 2 as const,
    teamId: 1 as const,
    champion: createArenaChampion({
      riotIdGameName: "zombie villager",
      championName: "Aatrox",
      kills: 8,
      deaths: 3,
      assists: 5,
      level: 18,
      items: [3074, 3071, 3071, 3036, 3035, 0, 3364],
      gold: 12450,
      damage: 28500,
      augments: [createMasterOfDualityAugment()],
      arenaMetrics: createArenaMetrics({
        playerScore0: 8,
        playerScore1: 5,
        playerScore2: 850.5,
        playerScore3: 0.45,
        playerScore4: 7.2,
        playerScore5: 2150.75,
        playerScore6: 5890.25,
        playerScore7: 425.5,
        playerScore8: 52.3,
      }),
      teamSupport: createTeamSupport({
        damageShieldedOnTeammate: 1200,
        healsOnTeammate: 450,
        damageTakenPercentage: 28,
      }),
    }),
    teammate: createArenaChampion({
      riotIdGameName: "support buddy",
      championName: "Leona",
      kills: 5,
      deaths: 2,
      assists: 12,
      level: 17,
      items: [3858, 3068, 3143, 3025, 3504, 0, 3364],
      gold: 10200,
      damage: 12300,
      augments: [createCourageAugment()],
      arenaMetrics: createArenaMetrics({
        playerScore0: 5,
        playerScore1: 12,
        playerScore2: 720.3,
        playerScore3: 0.38,
        playerScore4: 6.1,
        playerScore5: 1850.2,
        playerScore6: 4200.5,
        playerScore7: 380.2,
        playerScore8: 48.7,
      }),
      teamSupport: createTeamSupport({
        damageShieldedOnTeammate: 2800,
        healsOnTeammate: 1200,
        damageTakenPercentage: 35,
      }),
    }),
  } satisfies ArenaMatchPlayer;
}

export function getArenaExampleMatch(): ArenaMatch {
  const mainPlayer = getMainPlayer();
  const teams = getTeams();
  return ArenaMatchSchema.parse({
    durationInSeconds: 1200,
    queueType: "arena",
    players: [ArenaMatchPlayerSchema.parse(mainPlayer)],
    teams: teams.map((team) => ArenaTeamSchema.parse(team)),
  });
}
