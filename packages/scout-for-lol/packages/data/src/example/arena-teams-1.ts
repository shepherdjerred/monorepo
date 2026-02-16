import { type ArenaTeam, type Augment } from "@scout-for-lol/data";
import {
  createArenaChampion,
  createArenaMetrics,
  createTeamSupport,
} from "./arena-factories.ts";

export function getTeam1(
  masterAugment: Augment,
  courageAugment: Augment,
): ArenaTeam {
  return {
    teamId: 1 as const,
    placement: 2 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "zombie villager",
        championName: "Aatrox",
        kills: 8,
        deaths: 3,
        assists: 5,
        level: 18,
        items: [3074, 3071, 3071, 3036, 3035, 0, 3364],
        gold: 12450,
        damage: 28500,
        augments: [
          masterAugment,
          masterAugment,
          masterAugment,
          masterAugment,
          masterAugment,
          masterAugment,
        ],
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
      createArenaChampion({
        riotIdGameName: "support buddy",
        championName: "Leona",
        kills: 5,
        deaths: 2,
        assists: 12,
        level: 17,
        items: [3858, 3068, 3143, 3025, 3504, 0, 3364],
        gold: 10200,
        damage: 12300,
        augments: [
          courageAugment,
          courageAugment,
          courageAugment,
          courageAugment,
          courageAugment,
          courageAugment,
        ],
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
    ],
  };
}
