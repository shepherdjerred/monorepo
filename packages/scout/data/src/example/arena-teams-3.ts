import { type ArenaTeam } from "@shepherdjerred/scout-data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam3(): ArenaTeam {
  return {
    teamId: 3 as const,
    placement: 1 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "winner1",
        championName: "Ahri",
        kills: 10,
        deaths: 2,
        assists: 7,
        level: 18,
        items: [3135, 3089, 3145, 3020, 0, 0, 3364],
        gold: 15200,
        damage: 35800,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 10,
          playerScore1: 7,
          playerScore2: 950.8,
          playerScore3: 0.55,
          playerScore4: 8.5,
          playerScore5: 2500.2,
          playerScore6: 6800.5,
          playerScore7: 520.3,
          playerScore8: 58.9,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 400,
          healsOnTeammate: 250,
          damageTakenPercentage: 25,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "winner2",
        championName: "Thresh",
        kills: 7,
        deaths: 1,
        assists: 14,
        level: 18,
        items: [3091, 3060, 3504, 3001, 0, 0, 3364],
        gold: 13800,
        damage: 10500,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 7,
          playerScore1: 14,
          playerScore2: 820.6,
          playerScore3: 0.5,
          playerScore4: 7.8,
          playerScore5: 2200.1,
          playerScore6: 5200.4,
          playerScore7: 480.2,
          playerScore8: 55.3,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 3200,
          healsOnTeammate: 600,
          damageTakenPercentage: 22,
        }),
      }),
    ],
  };
}
