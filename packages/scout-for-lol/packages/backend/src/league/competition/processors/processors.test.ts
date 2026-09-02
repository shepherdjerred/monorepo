import { describe, expect, it } from "vitest";
import type {
  ChampionId,
  CompetitionCriteria,
  LeaguePuuid,
  RawMatch,
  Rank,
  Ranks,
} from "@scout-for-lol/data";
import {
  AccountIdSchema,
  ChampionIdSchema,
  PlayerIdSchema,
  rankToLeaguePoints,
} from "@scout-for-lol/data";
import { processCriteria } from "#src/league/competition/processors/index.ts";
import type { PlayerWithAccounts } from "#src/league/competition/processors/types.ts";

import { makeTestParticipant } from "#src/testing/riot-mocks.ts";
import { testAccountId, testPuuid } from "#src/testing/test-ids.ts";
// ============================================================================
// Test Fixtures
// ============================================================================

function createPlayer(
  id: number,
  alias: string,
  puuidSuffix: string,
): PlayerWithAccounts {
  return {
    id: PlayerIdSchema.parse(id),
    alias,
    discordId: testAccountId(String(id)),
    accounts: [
      {
        id: AccountIdSchema.parse(id),
        alias,
        puuid: testPuuid(puuidSuffix),
        region: "AMERICA_NORTH",
      },
    ],
  };
}

const playerA = createPlayer(1, "PlayerA", "a");
const playerB = createPlayer(2, "PlayerB", "b");
const playerC = createPlayer(3, "PlayerC", "c");
const allParticipants = [playerA, playerB, playerC];

const mostSoloGamesCriteria: CompetitionCriteria = {
  type: "MOST_GAMES_PLAYED",
  queues: ["solo"],
};
const highestSoloRankCriteria: CompetitionCriteria = {
  type: "HIGHEST_RANK",
  aggregation: "MAX",
  queues: ["solo"],
};
const soloRankClimbCriteria: CompetitionCriteria = {
  type: "MOST_RANK_CLIMB",
  aggregation: "MAX",
  queues: ["solo"],
};
const mostSoloWinsCriteria: CompetitionCriteria = {
  type: "MOST_WINS_PLAYER",
  queues: ["solo"],
};
const highestSoloWinRateCriteria: CompetitionCriteria = {
  type: "HIGHEST_WIN_RATE",
  minGames: 10,
  queues: ["solo"],
};

type MatchParticipant = {
  puuid: LeaguePuuid;
  championId: ChampionId;
  win: boolean;
};

const defaultChampionId = ChampionIdSchema.parse(1);
const opponentChampionId = ChampionIdSchema.parse(2);

function matchParticipant(
  puuidSuffix: string,
  win: boolean,
  championId = defaultChampionId,
): MatchParticipant {
  return {
    puuid: testPuuid(puuidSuffix),
    championId,
    win,
  };
}

function createMatch(
  queueId: number,
  participants: MatchParticipant[],
): RawMatch {
  return {
    metadata: {
      dataVersion: "2",
      matchId: `TEST_${crypto.randomUUID()}`,
      participants: participants.map((participant) => participant.puuid),
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
      participants: participants.map((participant, index) =>
        makeTestParticipant({
          puuid: participant.puuid,
          championId: participant.championId,
          win: participant.win,
          teamId: participant.win ? 100 : 200,
          participantId: index + 1,
          championName: "TestChampion",
          individualPosition: "TOP",
          role: "SOLO",
          teamPosition: "TOP",
          lane: "MIDDLE",
          kills: 5,
          deaths: 3,
          assists: 7,
          goldEarned: 10_000,
          goldSpent: 9000,
          totalDamageDealt: 100_000,
          totalDamageDealtToChampions: 15_000,
          totalDamageTaken: 20_000,
          totalHeal: 5000,
          totalMinionsKilled: 200,
          totalTimeCCDealt: 100,
          totalTimeSpentDead: 60,
          visionScore: 50,
          visionWardsBoughtInGame: 5,
          wardsKilled: 10,
          wardsPlaced: 15,
        }),
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

function createPlayerMatch(
  queueId: number,
  puuidSuffix: string,
  win: boolean,
  championId = defaultChampionId,
): RawMatch {
  return createMatch(queueId, [
    matchParticipant(puuidSuffix, win, championId),
    matchParticipant("other", !win, opponentChampionId),
  ]);
}

function createDuelMatch(
  queueId: number,
  firstPuuidSuffix: string,
  secondPuuidSuffix: string,
  firstWins: boolean,
): RawMatch {
  return createMatch(queueId, [
    matchParticipant(firstPuuidSuffix, firstWins),
    matchParticipant(secondPuuidSuffix, !firstWins, opponentChampionId),
  ]);
}

function repeatPlayerMatches(
  count: number,
  puuidSuffix: string,
  win: boolean,
  championId = defaultChampionId,
): RawMatch[] {
  return Array.from({ length: count }, () =>
    createPlayerMatch(420, puuidSuffix, win, championId),
  );
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

type RankScenario = {
  criteria: CompetitionCriteria;
  participants: PlayerWithAccounts[];
  currentRanks?: Record<number, Ranks>;
  startSnapshots?: Record<number, Ranks>;
  endSnapshots?: Record<number, Ranks>;
};

function processRankScenario({
  criteria,
  participants,
  currentRanks = {},
  startSnapshots = {},
  endSnapshots = {},
}: RankScenario) {
  return processCriteria(criteria, [], participants, {
    currentRanks,
    startSnapshots,
    endSnapshots,
  });
}

// ============================================================================
// Tests: Most Games Played
// ============================================================================

describe("processMostGamesPlayed", () => {
  it("should count games in SOLO queue only", () => {
    const matches = [
      createPlayerMatch(420, "a", true),
      createPlayerMatch(420, "a", true),
      createDuelMatch(1700, "a", "b", true),
      createPlayerMatch(1700, "b", true),
    ];

    const scores = new Map(
      processCriteria(mostSoloGamesCriteria, matches, [playerA, playerB]).map(
        (entry) => [entry.playerId, entry.score],
      ),
    );

    expect(scores.get(playerA.id)).toBe(2);
    expect(scores.get(playerB.id)).toBe(0);
  });

  it("should count games in ARENA queue only", () => {
    const matches = [
      createPlayerMatch(420, "a", true),
      createDuelMatch(1700, "a", "b", true),
      createPlayerMatch(1700, "b", true),
    ];

    const result = processCriteria(
      { type: "MOST_GAMES_PLAYED", queues: ["arena"] },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((entry) => entry.playerId === playerA.id);
    const playerBEntry = result.find((entry) => entry.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(1);
    expect(playerBEntry?.score).toBe(2);
  });
});

describe("processMostGamesPlayed across queue selections", () => {
  it("should count games across selected Solo and Flex queues", () => {
    const matches = [
      createPlayerMatch(420, "a", true),
      createPlayerMatch(420, "a", true),
      createPlayerMatch(440, "a", true),
      createPlayerMatch(1700, "b", true),
    ];

    const result = processCriteria(
      { type: "MOST_GAMES_PLAYED", queues: ["solo", "flex"] },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((entry) => entry.playerId === playerA.id);
    const playerBEntry = result.find((entry) => entry.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(3);
    expect(playerBEntry?.score).toBe(0);
  });

  it("interprets ALL within the selected game variant", () => {
    const matches = [
      createMatch(420, [matchParticipant("a", true)]),
      createMatch(4310, [
        matchParticipant("a", true, ChampionIdSchema.parse(60_001)),
      ]),
    ];

    const modern = processCriteria(
      { type: "MOST_GAMES_PLAYED", queues: ["ALL"] },
      matches,
      [playerA],
      undefined,
      "MODERN",
    );
    const classic = processCriteria(
      { type: "MOST_GAMES_PLAYED", queues: ["ALL"] },
      matches,
      [playerA],
      undefined,
      "CLASSIC",
    );

    expect(modern[0]?.score).toBe(1);
    expect(classic[0]?.score).toBe(1);
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

    const result = processRankScenario({
      criteria: highestSoloRankCriteria,
      participants: allParticipants,
      currentRanks,
    });

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

  const missingRankScenarios: {
    name: string;
    currentRanks: Record<number, Ranks>;
  }[] = [
    {
      name: "players absent from the ranks map",
      currentRanks: { [playerA.id]: { solo: diamondII } },
    },
    {
      name: "players whose ranks entry is missing the requested queue",
      currentRanks: {
        [playerA.id]: { solo: diamondII },
        [playerB.id]: { flex: platinumI },
      },
    },
  ];

  it.each(missingRankScenarios)("should skip $name", ({ currentRanks }) => {
    const result = processRankScenario({
      criteria: highestSoloRankCriteria,
      participants: [playerA, playerB],
      currentRanks,
    });

    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(playerA.id);
    expect(
      result.find((entry) => entry.playerId === playerB.id),
    ).toBeUndefined();
  });

  it("should not fabricate Iron IV 0 LP entries for any participant", () => {
    const currentRanks: Record<number, Ranks> = {
      [playerA.id]: { solo: diamondII },
    };

    const result = processRankScenario({
      criteria: highestSoloRankCriteria,
      participants: allParticipants,
      currentRanks,
    });

    const ironIvShape = {
      tier: "iron",
      division: 4,
      lp: 0,
      wins: 0,
      losses: 0,
    };
    for (const entry of result) {
      expect(entry.score).not.toEqual(ironIvShape);
    }
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

    const result = processRankScenario({
      criteria: soloRankClimbCriteria,
      participants: [playerA, playerB],
      startSnapshots,
      endSnapshots,
    });

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

    const result = processRankScenario({
      criteria: soloRankClimbCriteria,
      participants: [playerA, playerB],
      startSnapshots,
      endSnapshots,
    });

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

    const result = processRankScenario({
      criteria: soloRankClimbCriteria,
      participants: [playerA, playerB],
      startSnapshots,
      endSnapshots,
    });

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

    const result = processRankScenario({
      criteria: soloRankClimbCriteria,
      participants: [playerA, playerB],
      startSnapshots,
      endSnapshots,
    });

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

    const result = processRankScenario({
      criteria: soloRankClimbCriteria,
      participants: [playerA, playerB],
      startSnapshots,
      endSnapshots,
    });

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
      ...repeatPlayerMatches(2, "a", true),
      ...repeatPlayerMatches(1, "a", false),
      ...repeatPlayerMatches(3, "b", true),
    ];

    const result = processCriteria(mostSoloWinsCriteria, matches, [
      playerA,
      playerB,
    ]);

    const playerAEntry = result.find((entry) => entry.playerId === playerA.id);
    const playerBEntry = result.find((entry) => entry.playerId === playerB.id);

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
    const yasuoId = ChampionIdSchema.parse(157);
    const matches = [
      ...repeatPlayerMatches(2, "a", true, yasuoId),
      ...repeatPlayerMatches(1, "a", false, yasuoId),
      createPlayerMatch(420, "a", true),
      createPlayerMatch(420, "b", true, yasuoId),
      ...repeatPlayerMatches(2, "b", true),
    ];

    const result = processCriteria(
      {
        type: "MOST_WINS_CHAMPION",
        championId: yasuoId,
        queues: ["solo"],
      },
      matches,
      [playerA, playerB],
    );

    const playerAEntry = result.find((entry) => entry.playerId === playerA.id);
    const playerBEntry = result.find((entry) => entry.playerId === playerB.id);

    expect(playerAEntry?.score).toBe(2);
    expect(playerBEntry?.score).toBe(1);
    expect(playerAEntry?.metadata?.["championId"]).toBe(157);
    expect(playerAEntry?.metadata?.["games"]).toBe(3);
  });
});

// ============================================================================
// Tests: Highest Win Rate
// ============================================================================

describe("processHighestWinRate", () => {
  it("should calculate win rate with minimum games threshold", () => {
    const matches = [
      ...repeatPlayerMatches(15, "a", true),
      ...repeatPlayerMatches(5, "a", false),
      ...repeatPlayerMatches(8, "b", true),
      ...repeatPlayerMatches(2, "b", false),
      ...repeatPlayerMatches(10, "c", true),
      ...repeatPlayerMatches(10, "c", false),
    ];

    const result = processCriteria(
      highestSoloWinRateCriteria,
      matches,
      allParticipants,
    );

    expect(result.length).toBe(3);

    const playerAEntry = result.find((entry) => entry.playerId === playerA.id);
    const playerBEntry = result.find((entry) => entry.playerId === playerB.id);
    const playerCEntry = result.find((entry) => entry.playerId === playerC.id);

    expect(playerAEntry?.score).toBe(0.75);
    expect(playerBEntry?.score).toBe(0.8);
    expect(playerCEntry?.score).toBe(0.5);
  });

  it("should exclude players below minimum games", () => {
    const matches = [
      ...repeatPlayerMatches(8, "a", true),
      ...repeatPlayerMatches(1, "a", false),
      ...repeatPlayerMatches(10, "b", true),
    ];

    const result = processCriteria(highestSoloWinRateCriteria, matches, [
      playerA,
      playerB,
    ]);

    expect(result.length).toBe(1);
    expect(result[0]?.playerId).toBe(playerB.id);
    expect(result[0]?.score).toBe(1);
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
      processCriteria(mostSoloGamesCriteria, emptyMatches, emptyParticipants),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        highestSoloRankCriteria,
        emptyMatches,
        emptyParticipants,
        emptySnapshots,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        soloRankClimbCriteria,
        emptyMatches,
        emptyParticipants,
        emptySnapshots,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(mostSoloWinsCriteria, emptyMatches, emptyParticipants),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        {
          type: "MOST_WINS_CHAMPION",
          championId: ChampionIdSchema.parse(1),
          queues: ["solo"],
        },
        emptyMatches,
        emptyParticipants,
      ),
    ).not.toThrow();

    expect(() =>
      processCriteria(
        highestSoloWinRateCriteria,
        emptyMatches,
        emptyParticipants,
      ),
    ).not.toThrow();
  });
});
