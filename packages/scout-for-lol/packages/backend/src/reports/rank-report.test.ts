import { describe, expect, test } from "vitest";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import {
  DiscordAccountIdSchema,
  PlayerIdSchema,
  type Rank,
} from "@scout-for-lol/data";
import type { RankedLeaderboardEntry } from "#src/league/competition/leaderboard.ts";
import { aggregateRankLeaderboard } from "#src/reports/rank-report.ts";

/**
 * `aggregateRankLeaderboard` is the JS engine for `rank_current` and
 * `competition_rank` — the leaderboard equivalent of `aggregateFoldedGroups`
 * for `player_groups`. WHERE, GROUP BY, HAVING, ORDER BY and LIMIT all run
 * here, over an already-computed leaderboard, so the tests below never touch
 * a database.
 */

function rank(overrides: Partial<Rank> = {}): Rank {
  return {
    tier: "gold",
    division: 3,
    lp: 40,
    wins: 10,
    losses: 8,
    ...overrides,
  };
}

function entry(
  overrides: Partial<RankedLeaderboardEntry> = {},
): RankedLeaderboardEntry {
  return {
    playerId: PlayerIdSchema.parse(1),
    playerName: "Player1",
    score: 100,
    rank: 1,
    discordId: null,
    ...overrides,
  };
}

const LEADERBOARD: RankedLeaderboardEntry[] = [
  entry({
    playerId: PlayerIdSchema.parse(1),
    playerName: "Alice",
    rank: 1,
    score: 300,
    discordId: DiscordAccountIdSchema.parse("100000000000000001"),
  }),
  entry({
    playerId: PlayerIdSchema.parse(2),
    playerName: "Bob",
    rank: 2,
    score: 200,
  }),
  entry({
    playerId: PlayerIdSchema.parse(3),
    playerName: "Carol",
    rank: 3,
    score: 100,
  }),
  entry({
    playerId: PlayerIdSchema.parse(4),
    playerName: "Dave",
    rank: 4,
    score: 50,
  }),
];

describe("aggregateRankLeaderboard", () => {
  test("applies WHERE before GROUP BY player, unlike the pre-fix slice-and-map", () => {
    const plan = compileScoutQl(
      "SELECT player, MAX(rank) AS r FROM rank_current WHERE rank <= 2 GROUP BY player ORDER BY r ASC",
    );
    const rows = aggregateRankLeaderboard(plan, LEADERBOARD, false);
    expect(rows.map((row) => row.label)).toEqual(["Alice", "Bob"]);
  });

  test("applies a custom ORDER BY instead of the leaderboard's own order", () => {
    const plan = compileScoutQl(
      "SELECT player, MAX(rank) AS r FROM rank_current GROUP BY player ORDER BY r DESC",
    );
    const rows = aggregateRankLeaderboard(plan, LEADERBOARD, false);
    // Descending by rank position puts the worst-ranked player first — the
    // opposite of the leaderboard's own ascending storage order.
    expect(rows.map((row) => row.label)).toEqual([
      "Dave",
      "Carol",
      "Bob",
      "Alice",
    ]);
  });

  test("applies HAVING after aggregation", () => {
    const plan = compileScoutQl(
      "SELECT player, MAX(rank) AS r FROM rank_current GROUP BY player HAVING r <= 2 ORDER BY r ASC",
    );
    const rows = aggregateRankLeaderboard(plan, LEADERBOARD, false);
    expect(rows.map((row) => row.label)).toEqual(["Alice", "Bob"]);
  });

  test("evaluates the aggregate function rather than echoing the raw column", () => {
    // MIN(rank) picks the best (numerically lowest) rank in the grand total,
    // not whichever entry happens to be scanned first.
    const plan = compileScoutQl("SELECT MIN(rank) AS best FROM rank_current");
    const rows = aggregateRankLeaderboard(plan, LEADERBOARD, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe("All");
    expect(rows[0]?.outputs[0]?.value).toBe(1);
  });

  test("grand total (no GROUP BY) aggregates every surviving entry into one row", () => {
    const plan = compileScoutQl(
      "SELECT COUNT(*) AS n FROM rank_current WHERE rank <= 2",
    );
    const rows = aggregateRankLeaderboard(plan, LEADERBOARD, false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outputs[0]?.value).toBe(2);
  });

  test("renders MAX(score) as a rank name when the criterion is HIGHEST_RANK", () => {
    const leaderboard: RankedLeaderboardEntry[] = [
      entry({
        playerId: PlayerIdSchema.parse(1),
        playerName: "Alice",
        rank: 1,
        score: rank({ tier: "diamond", division: 2, lp: 60 }),
      }),
    ];
    const plan = compileScoutQl(
      "SELECT player, MAX(score) AS score FROM rank_current GROUP BY player",
    );
    const rows = aggregateRankLeaderboard(plan, leaderboard, true);
    expect(rows[0]?.outputs[1]?.value).toBe("Diamond II, 60LP");
  });

  test("falls back to the numeric league-points value for a multi-entry aggregate over rank scores", () => {
    const leaderboard: RankedLeaderboardEntry[] = [
      entry({
        playerId: PlayerIdSchema.parse(1),
        playerName: "Alice",
        score: rank({ tier: "gold", division: 3, lp: 40 }),
      }),
      entry({
        playerId: PlayerIdSchema.parse(2),
        playerName: "Bob",
        score: rank({ tier: "gold", division: 3, lp: 60 }),
      }),
    ];
    // SUM across two entries has no rank of its own — no single leaderboard
    // entry's score equals it — so it must not be rendered as a rank name.
    const plan = compileScoutQl("SELECT SUM(score) AS total FROM rank_current");
    const rows = aggregateRankLeaderboard(plan, leaderboard, true);
    expect(typeof rows[0]?.outputs[0]?.value).toBe("number");
  });
});
