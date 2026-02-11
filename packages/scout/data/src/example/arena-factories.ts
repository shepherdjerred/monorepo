import type { Augment } from "@shepherdjerred/scout-data";

export function createArenaMetrics(params: {
  playerScore0: number;
  playerScore1: number;
  playerScore2: number;
  playerScore3: number;
  playerScore4: number;
  playerScore5: number;
  playerScore6: number;
  playerScore7: number;
  playerScore8: number;
}) {
  return {
    playerScore0: params.playerScore0,
    playerScore1: params.playerScore1,
    playerScore2: params.playerScore2,
    playerScore3: params.playerScore3,
    playerScore4: params.playerScore4,
    playerScore5: params.playerScore5,
    playerScore6: params.playerScore6,
    playerScore7: params.playerScore7,
    playerScore8: params.playerScore8,
  };
}

export function createTeamSupport(params: {
  damageShieldedOnTeammate: number;
  healsOnTeammate: number;
  damageTakenPercentage: number;
}) {
  return {
    damageShieldedOnTeammate: params.damageShieldedOnTeammate,
    healsOnTeammate: params.healsOnTeammate,
    damageTakenPercentage: params.damageTakenPercentage,
  };
}

export function createArenaChampion(params: {
  riotIdGameName: string;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  level: number;
  items: number[];
  gold: number;
  damage: number;
  augments: Augment[];
  arenaMetrics: ReturnType<typeof createArenaMetrics>;
  teamSupport: ReturnType<typeof createTeamSupport>;
}) {
  return {
    riotIdGameName: params.riotIdGameName,
    championName: params.championName,
    kills: params.kills,
    deaths: params.deaths,
    assists: params.assists,
    level: params.level,
    items: params.items,
    gold: params.gold,
    damage: params.damage,
    augments: params.augments,
    arenaMetrics: params.arenaMetrics,
    teamSupport: params.teamSupport,
  };
}
