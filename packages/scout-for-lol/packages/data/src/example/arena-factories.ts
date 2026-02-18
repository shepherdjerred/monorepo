import type { Augment } from "@scout-for-lol/data";

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

/** Shared arena metrics for the Aatrox example champion */
export function getAatroxArenaMetrics() {
  return createArenaMetrics({
    playerScore0: 8,
    playerScore1: 5,
    playerScore2: 850.5,
    playerScore3: 0.45,
    playerScore4: 7.2,
    playerScore5: 2150.75,
    playerScore6: 5890.25,
    playerScore7: 425.5,
    playerScore8: 52.3,
  });
}

/** Shared team support for the Aatrox example champion */
export function getAatroxTeamSupport() {
  return createTeamSupport({
    damageShieldedOnTeammate: 1200,
    healsOnTeammate: 450,
    damageTakenPercentage: 28,
  });
}

/** Shared arena metrics for the Leona example champion */
export function getLeonaArenaMetrics() {
  return createArenaMetrics({
    playerScore0: 5,
    playerScore1: 12,
    playerScore2: 720.3,
    playerScore3: 0.38,
    playerScore4: 6.1,
    playerScore5: 1850.2,
    playerScore6: 4200.5,
    playerScore7: 380.2,
    playerScore8: 48.7,
  });
}

/** Shared team support for the Leona example champion */
export function getLeonaTeamSupport() {
  return createTeamSupport({
    damageShieldedOnTeammate: 2800,
    healsOnTeammate: 1200,
    damageTakenPercentage: 35,
  });
}

/** Create the shared Aatrox champion with specified augments */
export function createAatroxChampion(augments: Augment[]) {
  return createArenaChampion({
    riotIdGameName: "zombie villager",
    championName: "Aatrox",
    kills: 8,
    deaths: 3,
    assists: 5,
    level: 18,
    items: [3074, 3071, 3071, 3036, 3035, 0, 3364],
    gold: 12450,
    damage: 28500,
    augments,
    arenaMetrics: getAatroxArenaMetrics(),
    teamSupport: getAatroxTeamSupport(),
  });
}

/** Create the shared Leona champion with specified augments */
export function createLeonaChampion(augments: Augment[]) {
  return createArenaChampion({
    riotIdGameName: "support buddy",
    championName: "Leona",
    kills: 5,
    deaths: 2,
    assists: 12,
    level: 17,
    items: [3858, 3068, 3143, 3025, 3504, 0, 3364],
    gold: 10200,
    damage: 12300,
    augments,
    arenaMetrics: getLeonaArenaMetrics(),
    teamSupport: getLeonaTeamSupport(),
  });
}
