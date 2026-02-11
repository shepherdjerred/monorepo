import { type ArenaTeam } from "@shepherdjerred/scout-data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam7(): ArenaTeam {
  return {
    teamId: 7 as const,
    placement: 7 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "p7_1",
        championName: "Taliyah",
        kills: 1,
        deaths: 9,
        assists: 0,
        level: 11,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 1800,
        damage: 3200,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 1,
          playerScore1: 0,
          playerScore2: 200.2,
          playerScore3: 0.1,
          playerScore4: 1.5,
          playerScore5: 300.1,
          playerScore6: 900.3,
          playerScore7: 60.1,
          playerScore8: 10.1,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 0,
          healsOnTeammate: 0,
          damageTakenPercentage: 85,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "p7_2",
        championName: "Karthus",
        kills: 0,
        deaths: 8,
        assists: 0,
        level: 11,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 1500,
        damage: 2800,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 0,
          playerScore1: 0,
          playerScore2: 180.1,
          playerScore3: 0.08,
          playerScore4: 1.2,
          playerScore5: 250.2,
          playerScore6: 750.2,
          playerScore7: 50.2,
          playerScore8: 8.5,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 0,
          healsOnTeammate: 0,
          damageTakenPercentage: 90,
        }),
      }),
    ],
  };
}
