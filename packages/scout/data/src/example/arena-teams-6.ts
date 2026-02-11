import { type ArenaTeam } from "@shepherdjerred/scout-data";
import { createArenaChampion, createArenaMetrics, createTeamSupport } from "./arena-factories.ts";

export function getTeam6(): ArenaTeam {
  return {
    teamId: 6 as const,
    placement: 6 as const,
    players: [
      createArenaChampion({
        riotIdGameName: "p6_1",
        championName: "Yasuo",
        kills: 2,
        deaths: 8,
        assists: 1,
        level: 12,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 2800,
        damage: 6500,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 2,
          playerScore1: 1,
          playerScore2: 280.3,
          playerScore3: 0.15,
          playerScore4: 2.2,
          playerScore5: 500.1,
          playerScore6: 1400.2,
          playerScore7: 100.1,
          playerScore8: 16.5,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 0,
          healsOnTeammate: 0,
          damageTakenPercentage: 75,
        }),
      }),
      createArenaChampion({
        riotIdGameName: "p6_2",
        championName: "Zed",
        kills: 1,
        deaths: 7,
        assists: 0,
        level: 12,
        items: [0, 0, 0, 0, 0, 0, 3364],
        gold: 2400,
        damage: 5100,
        augments: [],
        arenaMetrics: createArenaMetrics({
          playerScore0: 1,
          playerScore1: 0,
          playerScore2: 250.5,
          playerScore3: 0.12,
          playerScore4: 1.9,
          playerScore5: 420.3,
          playerScore6: 1200.1,
          playerScore7: 80.2,
          playerScore8: 13.2,
        }),
        teamSupport: createTeamSupport({
          damageShieldedOnTeammate: 0,
          healsOnTeammate: 0,
          damageTakenPercentage: 80,
        }),
      }),
    ],
  };
}
