import { type ArenaTeam } from "@scout-for-lol/data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam2(): ArenaTeam {
  return {
    teamId: 2 as const,
    placement: 3 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "opponent1",
        championName: "Garen",
        kills: 6,
        deaths: 5,
        assists: 3,
        level: 16,
        items: [3071, 3068, 3036, 0, 0, 0, 3364],
        gold: 9100,
        damage: 18500,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 6,
          playerScore1: 3,
          playerScore2: 650.2,
          playerScore3: 0.35,
          playerScore4: 5.8,
          playerScore5: 1800.5,
          playerScore6: 4100.3,
          playerScore7: 320.1,
          playerScore8: 45.2,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 800,
          healsOnTeammate: 200,
          damageTakenPercentage: 32,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "opponent2",
        championName: "Lux",
        kills: 4,
        deaths: 4,
        assists: 8,
        level: 16,
        items: [3089, 3135, 0, 0, 0, 0, 3364],
        gold: 8500,
        damage: 14200,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 4,
          playerScore1: 8,
          playerScore2: 580.1,
          playerScore3: 0.32,
          playerScore4: 5.2,
          playerScore5: 1600.3,
          playerScore6: 3800.2,
          playerScore7: 290.5,
          playerScore8: 42.1,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 600,
          healsOnTeammate: 350,
          damageTakenPercentage: 40,
        }),
      }),
    ],
  };
}
