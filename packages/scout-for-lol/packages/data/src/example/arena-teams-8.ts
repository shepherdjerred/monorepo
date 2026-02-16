import { type ArenaTeam } from "@scout-for-lol/data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam8(): ArenaTeam {
  return {
    teamId: 8 as const,
    placement: 8 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "p8_1",
        championName: "Lissandra",
        kills: 0,
        deaths: 10,
        assists: 0,
        level: 10,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 1200,
        damage: 1500,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 0,
          playerScore1: 0,
          playerScore2: 150.1,
          playerScore3: 0.05,
          playerScore4: 1.0,
          playerScore5: 200.1,
          playerScore6: 600.1,
          playerScore7: 40.1,
          playerScore8: 6.2,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 0,
          healsOnTeammate: 0,
          damageTakenPercentage: 95,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "p8_2",
        championName: "Ryze",
        kills: 0,
        deaths: 9,
        assists: 0,
        level: 10,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 1000,
        damage: 1200,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 0,
          playerScore1: 0,
          playerScore2: 130.2,
          playerScore3: 0.04,
          playerScore4: 0.8,
          playerScore5: 150.2,
          playerScore6: 500.3,
          playerScore7: 30.1,
          playerScore8: 4.8,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 0,
          healsOnTeammate: 0,
          damageTakenPercentage: 95,
        }),
      }),
    ],
  };
}
