import { type ArenaTeam } from "@scout-for-lol/data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam4(): ArenaTeam {
  return {
    teamId: 4 as const,
    placement: 4 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "p4_1",
        championName: "Veigar",
        kills: 3,
        deaths: 6,
        assists: 2,
        level: 14,
        items: [3089, 0, 0, 0, 0, 0, 3364],
        gold: 5200,
        damage: 8900,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 3,
          playerScore1: 2,
          playerScore2: 420.1,
          playerScore3: 0.25,
          playerScore4: 3.5,
          playerScore5: 900.2,
          playerScore6: 2100.5,
          playerScore7: 180.1,
          playerScore8: 28.5,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 200,
          healsOnTeammate: 100,
          damageTakenPercentage: 55,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "p4_2",
        championName: "Morgana",
        kills: 2,
        deaths: 5,
        assists: 3,
        level: 14,
        items: [3020, 0, 0, 0, 0, 0, 3364],
        gold: 4800,
        damage: 5200,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 2,
          playerScore1: 3,
          playerScore2: 380.2,
          playerScore3: 0.22,
          playerScore4: 3.1,
          playerScore5: 800.5,
          playerScore6: 1900.3,
          playerScore7: 160.2,
          playerScore8: 25.2,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 500,
          healsOnTeammate: 350,
          damageTakenPercentage: 60,
        }),
      }),
    ],
  };
}
