import { describe, expect, test } from "bun:test";
import type { Rank } from "@scout-for-lol/data/index.ts";
import {
  computePlayerHistorySignals,
  formatPlayerHistory,
  type HistoryGame,
  type RankPoint,
  type TeammateResult,
  type CurrentGameContext,
} from "#src/league/review/player-history-signals.ts";

const NOW = new Date("2026-07-03T20:00:00Z"); // ~13:00 PDT on 2026-07-03

function game(overrides: Partial<HistoryGame>): HistoryGame {
  return {
    matchId: "NA1_1",
    gameCreationAt: new Date("2026-07-02T00:00:00Z"),
    championName: "LeeSin",
    lane: "jungle",
    queue: "solo",
    win: true,
    kills: 5,
    deaths: 5,
    assists: 5,
    creepScore: 150,
    durationSeconds: 1800,
    teamId: 100,
    ...overrides,
  };
}

function rank(
  tier: Rank["tier"],
  division: Rank["division"],
  lp: number,
): Rank {
  return { tier, division, lp, wins: 50, losses: 50 };
}

// Most-recent-first, matching the DB `orderBy gameCreationAt desc`.
const GAMES: HistoryGame[] = [
  game({
    matchId: "NA1_6",
    championName: "Yasuo",
    lane: "middle",
    win: false,
    gameCreationAt: new Date("2026-07-03T18:00:00Z"), // today (LA)
  }),
  game({
    matchId: "NA1_5",
    win: false,
    gameCreationAt: new Date("2026-07-03T02:00:00Z"), // 2026-07-02 19:00 PDT → yesterday in LA
  }),
  game({
    matchId: "NA1_4",
    win: false,
    gameCreationAt: new Date("2026-07-02T12:00:00Z"),
  }),
  game({
    matchId: "NA1_3",
    win: true,
    gameCreationAt: new Date("2026-07-01T12:00:00Z"),
  }),
  game({
    matchId: "NA1_2",
    championName: "Viego",
    win: true,
    gameCreationAt: new Date("2026-06-28T12:00:00Z"),
  }),
  game({
    matchId: "NA1_1",
    championName: "Viego",
    win: false,
    gameCreationAt: new Date("2026-06-20T12:00:00Z"), // outside the 7-day week
  }),
];

const RANK_POINTS: RankPoint[] = [
  {
    matchGameEndAt: new Date("2026-07-03T18:00:00Z"),
    rankBefore: rank("silver", 2, 40),
    rankAfter: rank("silver", 2, 25),
  },
  {
    matchGameEndAt: new Date("2026-07-01T12:00:00Z"),
    rankBefore: rank("silver", 2, 60),
    rankAfter: rank("silver", 2, 40),
  },
  {
    matchGameEndAt: new Date("2026-06-28T12:00:00Z"),
    rankBefore: rank("silver", 1, 10),
    rankAfter: rank("silver", 2, 80),
  },
];

const TEAMMATES: TeammateResult[] = [
  { alias: "Colin", win: true },
  { alias: "Colin", win: false },
  { alias: "Danny", win: false },
];

const CURRENT: CurrentGameContext = {
  championName: "Teemo",
  lane: "top",
  kills: 1,
  deaths: 8,
  assists: 2,
  creepScore: 100,
  durationSeconds: 1800,
};

describe("computePlayerHistorySignals", () => {
  const signals = computePlayerHistorySignals({
    games: GAMES,
    rankPoints: RANK_POINTS,
    teammates: TEAMMATES,
    currentGame: CURRENT,
    now: NOW,
  });

  test("detects the current loss streak", () => {
    expect(signals.streak).toEqual({ type: "loss", count: 3 });
  });

  test("computes last-10 record and recent winrate", () => {
    expect(signals.lastTen).toEqual({ wins: 2, losses: 4 });
    expect(signals.gamesInWindow).toBe(6);
    expect(signals.recentWinrate).toBeCloseTo(2 / 6, 5);
  });

  test("counts games today and this week in LA time", () => {
    expect(signals.gamesToday).toBe(1); // only the 2026-07-03T18:00Z game is today in LA
    expect(signals.gamesThisWeek).toBe(5); // all but the 2026-06-20 game
  });

  test("orders the champion pool by games played", () => {
    expect(signals.championPool.map((c) => c.champion)).toEqual([
      "LeeSin",
      "Viego",
      "Yasuo",
    ]);
    const leeSin = signals.championPool[0];
    expect(leeSin).toMatchObject({ champion: "LeeSin", games: 3, wins: 1 });
  });

  test("flags an off-pool, first-time champion this game", () => {
    expect(signals.thisGameChampion).toMatchObject({
      champion: "Teemo",
      games: 0,
      offPool: true,
      firstTime: true,
    });
  });

  test("finds the main lane and flags off-role", () => {
    expect(signals.mainLane).toEqual({ lane: "jungle", games: 5, total: 6 });
    expect(signals.offRole).toBe(true);
  });

  test("reports rank now, rank at the start of the window, and lp this week", () => {
    expect(signals.rankNow).toEqual(rank("silver", 2, 25));
    expect(signals.rankAgo).toEqual(rank("silver", 2, 80));
    // Only 3 snapshots exist, so the oldest is 2 games ago — not 10.
    expect(signals.rankAgoGames).toBe(2);
    expect(typeof signals.lpThisWeek).toBe("number");
  });

  test("does not report rank history from a single snapshot", () => {
    const single = computePlayerHistorySignals({
      games: GAMES,
      rankPoints: [
        {
          matchGameEndAt: new Date("2026-07-03T18:00:00Z"),
          rankBefore: rank("silver", 2, 40),
          rankAfter: rank("silver", 2, 25),
        },
      ],
      teammates: TEAMMATES,
      currentGame: CURRENT,
      now: NOW,
    });
    expect(single.rankNow).toEqual(rank("silver", 2, 25));
    expect(single.rankAgo).toBeUndefined();
    expect(single.rankAgoGames).toBeUndefined();
  });

  test("computes performance vs baseline", () => {
    expect(signals.performance).toBeDefined();
    // this game KDA = (1+2)/8 = 0.375; baseline avg is (5+5)/5 = 2 per game
    expect(signals.performance?.thisKda).toBeCloseTo(0.375, 5);
    expect(signals.performance?.avgKda).toBeCloseTo(2, 5);
  });

  test("aggregates duo records, most games first", () => {
    expect(signals.duos).toEqual([
      { alias: "Colin", wins: 1, losses: 1 },
      { alias: "Danny", wins: 0, losses: 1 },
    ]);
  });
});

describe("formatPlayerHistory", () => {
  test("renders a labeled block with the key signals", () => {
    const signals = computePlayerHistorySignals({
      games: GAMES,
      rankPoints: RANK_POINTS,
      teammates: TEAMMATES,
      currentGame: CURRENT,
      now: NOW,
    });
    const text = formatPlayerHistory(signals);
    expect(text).toContain("RECENT FORM — 3 losses in a row");
    expect(text).toContain("CHAMPS (last 6)");
    expect(text).toContain("This game: Teemo (first time on it");
    expect(text).toContain("2 games ago:");
    expect(text).toContain("LANE — Main: Jungle");
    expect(text).toContain("off-role this game");
    expect(text).toContain("DUOS — with Colin 1-1");
  });

  test("returns empty string when there is no history", () => {
    const empty = computePlayerHistorySignals({
      games: [],
      rankPoints: [],
      teammates: [],
      currentGame: CURRENT,
      now: NOW,
    });
    expect(formatPlayerHistory(empty)).toBe("");
  });
});
