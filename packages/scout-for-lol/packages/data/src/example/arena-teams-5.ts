import { type ArenaTeam } from "@scout-for-lol/data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam5(): ArenaTeam {
  return {
    teamId: 5 as const,
    placement: 5 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "p5_1",
        championName: "Ezreal",
        kills: 4,
        deaths: 7,
        assists: 1,
        level: 13,
        items: [3006, 0, 0, 0, 0, 0, 3364],
        gold: 4100,
        damage: 9200,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 4,
          playerScore1: 1,
          playerScore2: 350.5,
          playerScore3: 0.2,
          playerScore4: 2.9,
          playerScore5: 700.3,
          playerScore6: 1800.2,
          playerScore7: 140.5,
          playerScore8: 22.1,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 100,
          healsOnTeammate: 50,
          damageTakenPercentage: 65,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "p5_2",
        championName: "Evelynn",
        kills: 3,
        deaths: 6,
        assists: 2,
        level: 13,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 3500,
        damage: 4800,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 3,
          playerScore1: 2,
          playerScore2: 320.1,
          playerScore3: 0.18,
          playerScore4: 2.6,
          playerScore5: 620.2,
          playerScore6: 1600.1,
          playerScore7: 120.3,
          playerScore8: 19.8,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 50,
          healsOnTeammate: 0,
          damageTakenPercentage: 70,
        }),
      }),
    ],
  };
}
