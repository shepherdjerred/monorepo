import { describe, expect, it } from "bun:test";
import type {
  ChampionId,
  LeaguePuuid,
  RawMatch,
  RawPerks,
  Rank,
  Ranks,
} from "@scout-for-lol/data";
import {
  AccountIdSchema,
  ChampionIdSchema,
  PlayerIdSchema,
  rankToLeaguePoints,
} from "@scout-for-lol/data";
import { processCriteria } from "@scout-for-lol/backend/league/competition/processors/index.ts";
import type { PlayerWithAccounts } from "@scout-for-lol/backend/league/competition/processors/types.ts";

import {
  testAccountId,
  testPuuid,
} from "@scout-for-lol/backend/testing/test-ids.ts";
// ============================================================================
// Test Fixtures - Players
// ============================================================================

const playerA: PlayerWithAccounts = {
  id: PlayerIdSchema.parse(1),
  alias: "PlayerA",
  discordId: testAccountId("00000000"),
  accounts: [
    {
      id: AccountIdSchema.parse(1),
      alias: "PlayerA",
      puuid: testPuuid("a"),
      region: "AMERICA_NORTH",
    },
  ],
};

const playerB: PlayerWithAccounts = {
  id: PlayerIdSchema.parse(2),
  alias: "PlayerB",
  discordId: testAccountId("00000000"),
  accounts: [
    {
      id: AccountIdSchema.parse(2),
      alias: "PlayerB",
      puuid: testPuuid("b"),
      region: "AMERICA_NORTH",
    },
  ],
};

const playerC: PlayerWithAccounts = {
  id: PlayerIdSchema.parse(3),
  alias: "PlayerC",
  discordId: testAccountId("00000000"),
  accounts: [
    {
      id: AccountIdSchema.parse(3),
      alias: "PlayerC",
      puuid: testPuuid("c"),
      region: "AMERICA_NORTH",
    },
  ],
};

const allParticipants = [playerA, playerB, playerC];

// ============================================================================
// Test Fixtures - Match Factory
// ============================================================================

/**
 * Create a default challenges object with all required fields set to 0
 */
function createDefaultChallenges() {
  return {
    "12AssistStreakCount": 0,
    HealFromMapSources: 0,
    InfernalScalePickup: 0,
    SWARM_DefeatAatrox: 0,
    SWARM_DefeatBriar: 0,
    SWARM_DefeatMiniBosses: 0,
    SWARM_EvolveWeapon: 0,
    SWARM_Have3Passives: 0,
    SWARM_KillEnemy: 0,
    SWARM_PickupGold: 0,
    SWARM_ReachLevel50: 0,
    SWARM_Survive15Min: 0,
    SWARM_WinWith5EvolvedWeapons: 0,
    abilityUses: 0,
    acesBefore15Minutes: 0,
    alliedJungleMonsterKills: 0,
    baronTakedowns: 0,
    blastConeOppositeOpponentCount: 0,
    bountyGold: 0,
    buffsStolen: 0,
    completeSupportQuestInTime: 0,
    controlWardsPlaced: 0,
    damagePerMinute: 0,
    damageTakenOnTeamPercentage: 0,
    dancedWithRiftHerald: 0,
    deathsByEnemyChamps: 0,
    dodgeSkillShotsSmallWindow: 0,
    doubleAces: 0,
    dragonTakedowns: 0,
    effectiveHealAndShielding: 0,
    elderDragonKillsWithOpposingSoul: 0,
    elderDragonMultikills: 0,
    enemyChampionImmobilizations: 0,
    enemyJungleMonsterKills: 0,
    epicMonsterKillsNearEnemyJungler: 0,
    epicMonsterKillsWithin30SecondsOfSpawn: 0,
    epicMonsterSteals: 0,
    epicMonsterStolenWithoutSmite: 0,
    firstTurretKilled: 0,
    fistBumpParticipation: 0,
    flawlessAces: 0,
    fullTeamTakedown: 0,
    gameLength: 0,
    goldPerMinute: 0,
    hadOpenNexus: 0,
    immobilizeAndKillWithAlly: 0,
    initialBuffCount: 0,
    initialCrabCount: 0,
    jungleCsBefore10Minutes: 0,
    junglerTakedownsNearDamagedEpicMonster: 0,
    kTurretsDestroyedBeforePlatesFall: 0,
    kda: 0,
    killAfterHiddenWithAlly: 0,
    killParticipation: 0,
    killedChampTookFullTeamDamageSurvived: 0,
    killingSprees: 0,
    killsNearEnemyTurret: 0,
    killsOnOtherLanesEarlyJungleAsLaner: 0,
    killsOnRecentlyHealedByAramPack: 0,
    killsUnderOwnTurret: 0,
    killsWithHelpFromEpicMonster: 0,
    knockEnemyIntoTeamAndKill: 0,
    landSkillShotsEarlyGame: 0,
    laneMinionsFirst10Minutes: 0,
    legendaryCount: 0,
    legendaryItemUsed: [],
    lostAnInhibitor: 0,
    maxKillDeficit: 0,
    mejaisFullStackInTime: 0,
    moreEnemyJungleThanOpponent: 0,
    multiKillOneSpell: 0,
    multiTurretRiftHeraldCount: 0,
    multikills: 0,
    multikillsAfterAggressiveFlash: 0,
    outerTurretExecutesBefore10Minutes: 0,
    outnumberedKills: 0,
    outnumberedNexusKill: 0,
    perfectDragonSoulsTaken: 0,
    perfectGame: 0,
    pickKillWithAlly: 0,
    poroExplosions: 0,
    quickCleanse: 0,
    quickFirstTurret: 0,
    quickSoloKills: 0,
    riftHeraldTakedowns: 0,
    saveAllyFromDeath: 0,
    scuttleCrabKills: 0,
    skillshotsDodged: 0,
    skillshotsHit: 0,
    snowballsHit: 0,
    soloBaronKills: 0,
    soloKills: 0,
    stealthWardsPlaced: 0,
    survivedSingleDigitHpCount: 0,
    survivedThreeImmobilizesInFight: 0,
    takedownOnFirstTurret: 0,
    takedowns: 0,
    takedownsAfterGainingLevelAdvantage: 0,
    takedownsBeforeJungleMinionSpawn: 0,
    takedownsFirstXMinutes: 0,
    takedownsInAlcove: 0,
    takedownsInEnemyFountain: 0,
    teamBaronKills: 0,
    teamDamagePercentage: 0,
    teamElderDragonKills: 0,
    teamRiftHeraldKills: 0,
    tookLargeDamageSurvived: 0,
    turretPlatesTaken: 0,
    turretTakedowns: 0,
    turretsTakenWithRiftHerald: 0,
    twentyMinionsIn3SecondsCount: 0,
    twoWardsOneSweeperCount: 0,
    unseenRecalls: 0,
    visionScorePerMinute: 0,
    voidMonsterKill: 0,
    wardTakedowns: 0,
    wardTakedownsBefore20M: 0,
    wardsGuarded: 0,
  };
}

function createParticipant(
  puuid: LeaguePuuid,
  championId: ChampionId,
  win: boolean,
  participantId: number,
) {
  return {
    puuid,
    championId,
    win,
    teamId: win ? 100 : 200,
    kills: 5,
    deaths: 3,
    assists: 7,
    allInPings: 0,
    assistMePings: 0,
    baitPings: 0,
    baronKills: 0,
    basicPings: 0,
    bountyLevel: 0,
    challenges: createDefaultChallenges(),
    champExperience: 10_000,
    champLevel: 18,
    championName: "TestChampion",
    championTransform: 0,
    commandPings: 0,
    consumablesPurchased: 0,
    damageDealtToBuildings: 0,
    damageDealtToObjectives: 0,
    damageDealtToTurrets: 0,
    damageSelfMitigated: 0,
    dangerPings: 0,
    detectorWardsPlaced: 0,
    doubleKills: 0,
    dragonKills: 0,
    eligibleForProgression: true,
    enemyMissingPings: 0,
    enemyVisionPings: 0,
    firstBloodAssist: false,
    firstBloodKill: false,
    firstTowerAssist: false,
    firstTowerKill: false,
    gameEndedInEarlySurrender: false,
    gameEndedInSurrender: false,
    getBackPings: 0,
    goldEarned: 10_000,
    goldSpent: 9000,
    holdPings: 0,
    individualPosition: "TOP" as const,
    inhibitorKills: 0,
    inhibitorTakedowns: 0,
    inhibitorsLost: 0,
    item0: 0,
    item1: 0,
    item2: 0,
    item3: 0,
    item4: 0,
    item5: 0,
    item6: 0,
    itemsPurchased: 10,
    killingSprees: 0,
    largestCriticalStrike: 0,
    largestKillingSpree: 0,
    largestMultiKill: 0,
    longestTimeSpentLiving: 0,
    magicDamageDealt: 0,
    magicDamageDealtToChampions: 0,
    magicDamageTaken: 0,
    needVisionPings: 0,
    neutralMinionsKilled: 0,
    nexusKills: 0,
    nexusLost: 0,
    nexusTakedowns: 0,
    objectivesStolen: 0,
    objectivesStolenAssists: 0,
    onMyWayPings: 0,
    participantId,
    pentaKills: 0,
    profileIcon: 1,
    physicalDamageDealt: 0,
    physicalDamageDealtToChampions: 0,
    physicalDamageTaken: 0,
    placement: 0,
    playerAugment1: 0,
    playerAugment2: 0,
    playerAugment3: 0,
    playerAugment4: 0,
    playerScore0: 0,
    playerScore1: 0,
    playerScore2: 0,
    playerScore3: 0,
    playerScore4: 0,
    playerScore5: 0,
    playerScore6: 0,
    playerScore7: 0,
    playerScore8: 0,
    playerScore9: 0,
    playerSubteamId: 0,
    pushPings: 0,
    quadraKills: 0,
    riotIdGameName: "",
    riotIdName: "",
    riotIdTagline: "",
    role: "SOLO" as const,
    sightWardsBoughtInGame: 0,
    spell1Casts: 0,
    spell2Casts: 0,
    spell3Casts: 0,
    spell4Casts: 0,
    subteamPlacement: 0,
    summoner1Casts: 0,
    summoner1Id: 0,
    summoner2Casts: 0,
    summoner2Id: 0,
    summonerId: "",
    summonerLevel: 30,
    summonerName: "",
    teamEarlySurrendered: false,
    teamPosition: "TOP" as const,
    timeCCingOthers: 0,
    timePlayed: 1800,
    totalAllyJungleMinionsKilled: 0,
    totalDamageDealt: 100_000,
    totalDamageDealtToChampions: 15_000,
    totalDamageShieldedOnTeammates: 0,
    totalDamageTaken: 20_000,
    totalEnemyJungleMinionsKilled: 0,
    totalHeal: 5000,
    totalHealsOnTeammates: 0,
    totalMinionsKilled: 200,
    totalTimeCCDealt: 100,
    totalTimeSpentDead: 60,
    totalUnitsHealed: 1,
    tripleKills: 0,
    trueDamageDealt: 0,
    trueDamageDealtToChampions: 0,
    trueDamageTaken: 0,
    turretKills: 0,
    turretTakedowns: 0,
    turretsLost: 0,
    unrealKills: 0,
    visionClearedPings: 0,
    visionScore: 50,
    visionWardsBoughtInGame: 5,
    wardsKilled: 10,
    wardsPlaced: 15,
    lane: "MIDDLE" as const,
    missions: {
      playerScore0: 0,
      playerScore1: 0,
      playerScore2: 0,
      playerScore3: 0,
      playerScore4: 0,
      playerScore5: 0,
      playerScore6: 0,
      playerScore7: 0,
      playerScore8: 0,
      playerScore9: 0,
      playerScore10: 0,
      playerScore11: 0,
    },
    perks: {
      statPerks: {
        defense: 0,
        flex: 0,
        offense: 0,
      },
      styles: [],
    } satisfies RawPerks,
    retreatPings: 0,
    totalDamageDealtToBuildings: 0,
    totalDamageTakenFromAllSources: 0,
    totalHealsForAlly: 0,
    totalHealsTaken: 0,
    totalMinionsKilledInEnemyJungle: 0,
    totalMinionsKilledInNeutralJungle: 0,
    totalMinionsKilledInTeamJungle: 0,
  };
}

function createMatch(
  queueId: number,
  participants: {
    puuid: LeaguePuuid;
    championId: ChampionId;
    win: boolean;
  }[],
): RawMatch {
  return {
    metadata: {
      dataVersion: "2",
      matchId: `TEST_${Date.now().toString()}`,
      participants: participants.map((p) => p.puuid),
    },
    info: {
      gameCreation: Date.now(),
      gameDuration: 1800,
      gameEndTimestamp: Date.now(),
      gameId: 1,
      gameMode: "CLASSIC",
      gameName: "",
      gameStartTimestamp: Date.now(),
      gameType: "MATCHED_GAME",
      mapId: 11,
      participants: participants.map((p, index) =>
        createParticipant(p.puuid, p.championId, p.win, index + 1),
      ),
      platformId: "NA1",
      queueId,
      teams: [],
      tournamentCode: "",
      endOfGameResult: "WIN",
      gameVersion: "13.1.1",
    },
  };
}

// ============================================================================
// Test Fixtures - Ranks
// ============================================================================

const diamondII: Rank = {
  tier: "diamond",
  division: 2,
  lp: 50,
  wins: 100,
  losses: 80,
};

const diamondIII: Rank = {
  tier: "diamond",
  division: 3,
  lp: 75,
  wins: 90,
  losses: 85,
};

const platinumI: Rank = {
  tier: "platinum",
  division: 1,
  lp: 80,
  wins: 80,
  losses: 70,
};

const goldIV: Rank = {
  tier: "gold",
  division: 4,
  lp: 20,
  wins: 50,
  losses: 50,
};

const diamondIV: Rank = {
  tier: "diamond",
  division: 4,
  lp: 30,
  wins: 120,
  losses: 100,
};

const platinumII: Rank = {
  tier: "platinum",
  division: 2,
  lp: 60,
  wins: 85,
  losses: 75,
};

const silverIV: Rank = {
  tier: "silver",
  division: 4,
  lp: 10,
  wins: 30,
  losses: 28,
};

const goldI: Rank = {
  tier: "gold",
  division: 1,
  lp: 75,
  wins: 60,
  losses: 55,
};

const platinumIV: Rank = {
  tier: "platinum",
  division: 4,
  lp: 15,
  wins: 75,
  losses: 65,
};

// ============================================================================
// Tests: Most Games Played
// ============================================================================

describe("processMostGamesPlayed", () => {
  it("should count games in SOLO queue only", () => {
    const matches = [
      // SOLO queue matches
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      // ARENA matches
      createMatch(1700, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(1700, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
    ];

    const result = processCriteria(
      { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(2); // 2 solo games
    expect(playerBEntry?.score).toBe(0); // 0 solo games
  });

  it("should count games in ARENA queue only", () => {
    const matches = [
      // SOLO queue matches
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      // ARENA matches
      createMatch(1700, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(1700, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
    ];

    const result = processCriteria(
      { type: "MOST_GAMES_PLAYED", queue: "ARENA" },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(1); // 1 arena game
    expect(playerBEntry?.score).toBe(2); // 2 arena games
  });

  it("should count games in RANKED_ANY (SOLO + FLEX)", () => {
    const matches = [
      // SOLO queue
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      // FLEX queue
      createMatch(440, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      // ARENA (should not count)
      createMatch(1700, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
    ];

    const result = processCriteria(
      { type: "MOST_GAMES_PLAYED", queue: "RANKED_ANY" },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(3); // 2 solo + 1 flex
    expect(playerBEntry?.score).toBe(0); // 0 ranked games
  });
});

// ============================================================================
// Tests: Highest Rank
// ============================================================================

describe("processHighestRank", () => {
  it("should rank players by current rank (Diamond II > Diamond III > Platinum I)", () => {
    const currentRanks: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondII },
      [playerB.id]: { solo: platinumI },
      [playerC.id]: { solo: diamondIII },
    };

    const result = processCriteria(
      { type: "HIGHEST_RANK", queue: "SOLO" },
      [],
      allParticipants,
      {
        currentRanks,
        startSnapshots: {},
        endSnapshots: {},
      },
    );

    // Check that all players are included
    expect(result.length).toBe(3);

    // Check scores (ranks)
    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);
    const playerCEntry = result.find((e) => e.playerId === playerC.id);

    expect(playerAEntry?.score).toEqual(diamondII);
    expect(playerBEntry?.score).toEqual(platinumI);
    expect(playerCEntry?.score).toEqual(diamondIII);

    // Verify LP metadata for ordering
    expect(playerAEntry?.metadata?.["leaguePoints"]).toBe(
      rankToLeaguePoints(diamondII),
    );
    expect(playerCEntry?.metadata?.["leaguePoints"]).toBe(
      rankToLeaguePoints(diamondIII),
    );
    expect(playerBEntry?.metadata?.["leaguePoints"]).toBe(
      rankToLeaguePoints(platinumI),
    );
  });

  it("should use unranked (Iron IV 0 LP) for players without rank", () => {
    const currentRanks: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondII },
      // playerB has no rank
    };

    const result = processCriteria(
      { type: "HIGHEST_RANK", queue: "SOLO" },
      [],
      [playerA, playerB],
      {
        currentRanks,
        startSnapshots: {},
        endSnapshots: {},
      },
    );

    const playerBEntry = result.find((e) => e.playerId === playerB.id);
    expect(playerBEntry?.score).toEqual({
      tier: "iron",
      division: 4,
      lp: 0,
      wins: 0,
      losses: 0,
    });
  });
});

// ============================================================================
// Tests: Most Rank Climb
// ============================================================================

describe("processMostRankClimb", () => {
  it("should calculate LP gained from start to end", () => {
    const startSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: goldIV },
      [playerB.id]: { solo: platinumII },
    };

    const endSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondIV }, // Gold IV → Diamond IV = +400 LP
      [playerB.id]: { solo: platinumI }, // Platinum II → Platinum I = +100 LP
    };

    const result = processCriteria(
      { type: "MOST_RANK_CLIMB", queue: "SOLO" },
      [],
      [playerA, playerB],
      {
        currentRanks: {},
        startSnapshots,
        endSnapshots,
      },
    );

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    const playerALPGain =
      rankToLeaguePoints(diamondIV) - rankToLeaguePoints(goldIV);
    const playerBLPGain =
      rankToLeaguePoints(platinumI) - rankToLeaguePoints(platinumII);

    expect(playerAEntry?.score).toBe(playerALPGain);
    expect(playerBEntry?.score).toBe(playerBLPGain);
    expect(playerALPGain).toBeGreaterThan(playerBLPGain);
  });

  it("should skip participants without START snapshot (unranked at competition start)", () => {
    const startSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: goldIV }, // PlayerA has START snapshot
      // PlayerB has no START snapshot (was unranked)
    };

    const endSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondIV },
      [playerB.id]: { solo: goldI }, // PlayerB got ranked later
    };

    const result = processCriteria(
      { type: "MOST_RANK_CLIMB", queue: "SOLO" },
      [],
      [playerA, playerB],
      {
        currentRanks: {},
        startSnapshots,
        endSnapshots,
      },
    );

    // Only playerA should be in the result
    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(playerA.id);
  });

  it("should skip participants without END snapshot", () => {
    const startSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: goldIV },
      [playerB.id]: { solo: silverIV },
    };

    const endSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondIV },
      // PlayerB has no END snapshot
    };

    const result = processCriteria(
      { type: "MOST_RANK_CLIMB", queue: "SOLO" },
      [],
      [playerA, playerB],
      {
        currentRanks: {},
        startSnapshots,
        endSnapshots,
      },
    );

    // Only playerA should be in the result
    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(playerA.id);
  });

  it("should skip participants without rank data for the specific queue", () => {
    const startSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: goldIV }, // Has solo rank
      [playerB.id]: { flex: silverIV }, // Has only flex rank, not solo
    };

    const endSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondIV },
      [playerB.id]: { flex: goldI },
    };

    const result = processCriteria(
      { type: "MOST_RANK_CLIMB", queue: "SOLO" },
      [],
      [playerA, playerB],
      {
        currentRanks: {},
        startSnapshots,
        endSnapshots,
      },
    );

    // Only playerA should be in the result (has solo rank)
    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(playerA.id);
  });

  it("should include participant who gets ranked mid-competition (has both snapshots)", () => {
    const startSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: goldIV },
      [playerB.id]: { solo: silverIV }, // PlayerB got placed mid-competition, has START snapshot from that point
    };

    const endSnapshots: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondIV },
      [playerB.id]: { solo: platinumIV }, // PlayerB climbed after placement
    };

    const result = processCriteria(
      { type: "MOST_RANK_CLIMB", queue: "SOLO" },
      [],
      [playerA, playerB],
      {
        currentRanks: {},
        startSnapshots,
        endSnapshots,
      },
    );

    // Both players should be in the result
    expect(result.length).toBe(2);

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    expect(playerAEntry).toBeDefined();
    expect(playerBEntry).toBeDefined();

    // Both should have their respective LP gains calculated correctly
    const playerALPGain =
      rankToLeaguePoints(diamondIV) - rankToLeaguePoints(goldIV);
    const playerBLPGain =
      rankToLeaguePoints(platinumIV) - rankToLeaguePoints(silverIV);

    expect(playerAEntry?.score).toBe(playerALPGain);
    expect(playerBEntry?.score).toBe(playerBLPGain);
  });
});

// ============================================================================
// Tests: Most Wins Player
// ============================================================================

describe("processMostWinsPlayer", () => {
  it("should count total wins for each player", () => {
    const matches = [
      // PlayerA: 2 wins
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: false,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: true,
        },
      ]),
      // PlayerB: 3 wins
      createMatch(420, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
    ];

    const result = processCriteria(
      { type: "MOST_WINS_PLAYER", queue: "SOLO" },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(2);
    expect(playerBEntry?.score).toBe(3);
    expect(playerAEntry?.metadata?.["wins"]).toBe(2);
    expect(playerAEntry?.metadata?.["losses"]).toBe(1);
    expect(playerBEntry?.metadata?.["wins"]).toBe(3);
    expect(playerBEntry?.metadata?.["losses"]).toBe(0);
  });
});

// ============================================================================
// Tests: Most Wins Champion
// ============================================================================

describe("processMostWinsChampion", () => {
  it("should count wins with specific champion only", () => {
    const yasuoId = 157;
    const matches = [
      // PlayerA: 2 Yasuo wins, 1 Yasuo loss
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(yasuoId),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(yasuoId),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(yasuoId),
          win: false,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: true,
        },
      ]),
      // PlayerA with other champion (should not count)
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      // PlayerB: 1 Yasuo win
      createMatch(420, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(yasuoId),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      // PlayerB with other champion (should not count)
      createMatch(420, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
      createMatch(420, [
        {
          puuid: testPuuid("b"),
          championId: ChampionIdSchema.parse(1),
          win: true,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: false,
        },
      ]),
    ];

    const result = processCriteria(
      {
        type: "MOST_WINS_CHAMPION",
        championId: ChampionIdSchema.parse(yasuoId),
        queue: "SOLO",
      },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(2); // 2 Yasuo wins
    expect(playerBEntry?.score).toBe(1); // 1 Yasuo win
    expect(playerAEntry?.metadata?.["championId"]).toBe(yasuoId);
    expect(playerAEntry?.metadata?.["games"]).toBe(3); // 3 Yasuo games total
  });
});

// ============================================================================
// Tests: Highest Win Rate
// ============================================================================

describe("processHighestWinRate", () => {
  it("should calculate win rate with minimum games threshold", () => {
    const matches = [
      // PlayerA: 15 wins, 5 losses (75% win rate, 20 games)
      ...Array.from({ length: 15 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("a"),
            championId: ChampionIdSchema.parse(1),
            win: true,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: false,
          },
        ]),
      ),
      ...Array.from({ length: 5 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("a"),
            championId: ChampionIdSchema.parse(1),
            win: false,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: true,
          },
        ]),
      ),
      // PlayerB: 8 wins, 2 losses (80% win rate, but only 10 games - exactly at threshold)
      ...Array.from({ length: 8 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("b"),
            championId: ChampionIdSchema.parse(1),
            win: true,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: false,
          },
        ]),
      ),
      ...Array.from({ length: 2 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("b"),
            championId: ChampionIdSchema.parse(1),
            win: false,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: true,
          },
        ]),
      ),
      // PlayerC: 10 wins, 10 losses (50% win rate, 20 games)
      ...Array.from({ length: 10 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("c"),
            championId: ChampionIdSchema.parse(1),
            win: true,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: false,
          },
        ]),
      ),
      ...Array.from({ length: 10 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("c"),
            championId: ChampionIdSchema.parse(1),
            win: false,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: true,
          },
        ]),
      ),
    ];

    const result = processCriteria(
      { type: "HIGHEST_WIN_RATE", minGames: 10, queue: "SOLO" },
      matches,
      allParticipants,
    );

    // All players should be included (all have >= 10 games)
    expect(result.length).toBe(3);

    const playerAEntry = result.find((e) => e.playerId === playerA.id);
    const playerBEntry = result.find((e) => e.playerId === playerB.id);
    const playerCEntry = result.find((e) => e.playerId === playerC.id);

    expect(playerAEntry?.score).toBe(0.75); // 75%
    expect(playerBEntry?.score).toBe(0.8); // 80%
    expect(playerCEntry?.score).toBe(0.5); // 50%
  });

  it("should exclude players below minimum games", () => {
    const matches = [
      // PlayerA: 8 wins, 1 loss (only 9 games, below min of 10)
      ...Array.from({ length: 8 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("a"),
            championId: ChampionIdSchema.parse(1),
            win: true,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: false,
          },
        ]),
      ),
      createMatch(420, [
        {
          puuid: testPuuid("a"),
          championId: ChampionIdSchema.parse(1),
          win: false,
        },
        {
          puuid: testPuuid("other"),
          championId: ChampionIdSchema.parse(2),
          win: true,
        },
      ]),
      // PlayerB: 10 wins, 0 losses (exactly 10 games, should be included)
      ...Array.from({ length: 10 }, () =>
        createMatch(420, [
          {
            puuid: testPuuid("b"),
            championId: ChampionIdSchema.parse(1),
            win: true,
          },
          {
            puuid: testPuuid("other"),
            championId: ChampionIdSchema.parse(2),
            win: false,
          },
        ]),
      ),
    ];

    const result = processCriteria(
      { type: "HIGHEST_WIN_RATE", minGames: 10, queue: "SOLO" },
      matches,
      [playerA, playerB],
    );

    // Only PlayerB should be included (PlayerA has < 10 games)
    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(playerB.id);
    expect(result[0]?.score).toBe(1); // 100% win rate
  });
});

// ============================================================================
// Tests: Dispatcher Exhaustiveness
// ============================================================================

describe("processCriteria dispatcher", () => {
  it("should handle all criteria types without errors", () => {
    const emptyMatches: RawMatch[] = [];
    const emptyParticipants: PlayerWithAccounts[] = [];
    const emptySnapshots = {
      currentRanks: {},
      startSnapshots: {},
      endSnapshots: {},
    };

    // This test verifies that TypeScript compilation succeeds with .exhaustive()
    // If any criteria type is missing, TypeScript would fail to compile

    expect(() =>
      processCriteria(
        { type: "MOST_GAMES_PLAYED", queue: "SOLO" },
        emptyMatches,
        emptyParticipants,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        { type: "HIGHEST_RANK", queue: "SOLO" },
        emptyMatches,
        emptyParticipants,
        emptySnapshots,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        { type: "MOST_RANK_CLIMB", queue: "SOLO" },
        emptyMatches,
        emptyParticipants,
        emptySnapshots,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        { type: "MOST_WINS_PLAYER", queue: "SOLO" },
        emptyMatches,
        emptyParticipants,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        {
          type: "MOST_WINS_CHAMPION",
          championId: ChampionIdSchema.parse(1),
          queue: "SOLO",
        },
        emptyMatches,
        emptyParticipants,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        { type: "HIGHEST_WIN_RATE", minGames: 10, queue: "SOLO" },
        emptyMatches,
        emptyParticipants,
      ),
    ).not.toThrow();
  });
});
