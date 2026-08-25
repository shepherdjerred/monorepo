import { afterAll, describe, expect, test } from "vitest";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  ReportIdSchema,
} from "@scout-for-lol/data";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import corpus from "./fixtures/scoutql-v2-legacy-corpus.json" with { type: "json" };
import {
  convertLegacyQueryText,
  convertStoredQuery,
  isAlreadyV2,
} from "./scoutql-v2-convert.ts";
import { UnconvertibleQueryError } from "./scoutql-v2-unconvertible.ts";

const backendRoot = `${import.meta.dir}/..`;
// Every temporaryDatabase() call gets its own isolated Postgres database
// cloned from the shared test template (createTestDatabase); the migration
// CLI runs as a real subprocess against its connection URL, exactly as it
// runs against production. Keyed by that URL so insertReports/readReports can
// find the client without changing every call site's signature.
const openClients = new Map<string, ExtendedPrismaClient>();

afterAll(async () => {
  await Promise.all(
    [...openClients.values()].map((client) => client.$disconnect()),
  );
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** `WHERE`-less legacy prefix; every case states its own period. */
const LOOKBACK = "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'";

/**
 * A legacy query whose ordering is the grouping label.
 *
 * Ordering deliberately does not default: legacy fell back to the raw game
 * count even when the report did not display it, and v2 orders only by an
 * output or a grouping — so an omitted ORDER BY is a refusal (pinned below),
 * not a shape these table cases should lean on.
 */
function legacy(select: string, tail = "ORDER BY player DESC"): string {
  return `SELECT ${select} FROM match_participants WHERE ${LOOKBACK} GROUP BY player ${tail}`;
}

/** The SELECT list of a converted query, which is what the table pins. */
function convertedSelect(select: string, tail?: string): string {
  const rewritten = convertLegacyQueryText(legacy(select, tail));
  const match = /^SELECT (?<items>.*?) FROM /u.exec(rewritten);
  const items = match?.groups?.["items"];
  if (items === undefined) {
    throw new Error(`Could not read the SELECT list of "${rewritten}".`);
  }
  return items;
}

function refusal(queryText: string): string {
  const result = convertStoredQuery(queryText);
  if (result.kind !== "unconvertible") {
    throw new Error(
      `Expected "${queryText}" to be unconvertible, got ${result.kind}.`,
    );
  }
  return result.reason;
}

/** A Report row's other required columns, fixed since the migration never reads them. */
const REPORT_DEFAULTS = {
  serverId: DiscordGuildIdSchema.parse("880000000000000001"),
  ownerId: DiscordAccountIdSchema.parse("880000000000000002"),
  channelId: DiscordChannelIdSchema.parse("880000000000000003"),
  cronExpression: "0 0 * * 0",
  createdTime: new Date("2026-01-01T00:00:00.000Z"),
  updatedTime: new Date("2026-01-01T00:00:00.000Z"),
};

async function temporaryDatabase(name: string): Promise<string> {
  const { prisma, dbUrl } = createTestDatabase(`scoutql-migration-${name}`);
  openClients.set(dbUrl, prisma);
  return dbUrl;
}

function clientFor(databaseUrl: string): ExtendedPrismaClient {
  const client = openClients.get(databaseUrl);
  if (client === undefined) {
    throw new Error(`No test database was created for ${databaseUrl}.`);
  }
  return client;
}

async function insertReports(
  databaseUrl: string,
  reports: { id: number; title: string; queryText: string }[],
): Promise<void> {
  const prisma = clientFor(databaseUrl);
  for (const report of reports) {
    await prisma.report.create({
      data: {
        ...REPORT_DEFAULTS,
        ...report,
        id: ReportIdSchema.parse(report.id),
      },
    });
  }
}

async function readReports(
  databaseUrl: string,
): Promise<{ id: number; queryText: string }[]> {
  const prisma = clientFor(databaseUrl);
  return prisma.report.findMany({
    select: { id: true, queryText: true },
    orderBy: { id: "asc" },
  });
}

async function runMigration(
  databasePath: string,
  fix: boolean,
): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn({
    cmd: [
      "bun",
      "scripts/migrate-scoutql-v2.ts",
      "--database",
      databasePath,
      ...(fix ? ["--fix"] : []),
    ],
    cwd: backendRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, output: `${stdout}\n${stderr}` };
}

// ── The live corpus ──────────────────────────────────────────────────────────

const CORPUS_ROWS: { env: string; id: number; queryText: string }[] =
  corpus.rows;

describe("the captured beta/prod corpus", () => {
  test("has the 15 rows the cutover was planned against", () => {
    expect(CORPUS_ROWS).toHaveLength(15);
  });

  for (const row of CORPUS_ROWS) {
    test(`[${row.env}/${row.id.toString()}] converts and verifies`, () => {
      // Nothing stored today is accidentally valid v2 — otherwise the
      // idempotence short-circuit would skip a row that still needs rewriting.
      expect(isAlreadyV2(row.queryText)).toBe(false);
      // convertLegacyQueryText runs the two-route check internally and throws
      // when the routes disagree, so reaching a v2 plan here is the assertion.
      const rewritten = convertLegacyQueryText(row.queryText);
      expect(() => compileScoutQl(rewritten)).not.toThrow();
    });

    test(`[${row.env}/${row.id.toString()}] is idempotent`, () => {
      const rewritten = convertLegacyQueryText(row.queryText);
      expect(convertStoredQuery(rewritten)).toEqual({ kind: "already-v2" });
    });
  }
});

describe("text valid under both grammars with different meanings", () => {
  // Legacy `SELECT kills FROM match_participants GROUP BY all` means a
  // grand-total SUM(kills). v2 treats the bare `kills` column as a DuckDB
  // `GROUP BY ALL` grouping instead — a completely different report. Trusting
  // "compiles as v2" alone would let this row skip conversion and silently
  // start reporting per-kill-count buckets instead of a total.
  const ambiguous =
    "SELECT kills FROM match_participants " +
    `WHERE ${LOOKBACK} GROUP BY all ORDER BY kills DESC`;

  test("is not classified as already-v2", () => {
    expect(isAlreadyV2(ambiguous)).toBe(false);
  });

  test("converts to the disambiguated grand-total rewrite", () => {
    expect(convertStoredQuery(ambiguous)).toEqual({
      kind: "converted",
      queryText: convertLegacyQueryText(ambiguous),
    });
    const rewritten = convertLegacyQueryText(ambiguous);
    expect(rewritten).toContain("SUM(kills)");
    expect(rewritten).not.toContain("GROUP BY all");
  });

  // The legacy default of ordering by an unselected "games" column has no
  // v2 equivalent to fall back to; that must refuse rather than crash.
  test("refuses rather than crashing when the legacy default has no v2 target", () => {
    const noExplicitOrder =
      "SELECT kills FROM match_participants " +
      `WHERE ${LOOKBACK} GROUP BY all`;
    expect(() => isAlreadyV2(noExplicitOrder)).not.toThrow();
    expect(isAlreadyV2(noExplicitOrder)).toBe(false);
    const result = convertStoredQuery(noExplicitOrder);
    expect(result.kind).toBe("unconvertible");
  });
});

// ── One case per rewrite-table row ───────────────────────────────────────────

describe("metrics become explicit aggregates keeping their legacy names", () => {
  test("games counts rows", () => {
    expect(convertedSelect("games")).toBe("COUNT(*) AS games");
  });

  test("wins and losses become filtered counts", () => {
    expect(convertedSelect("wins, losses")).toBe(
      "COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) FILTER (WHERE NOT win) AS losses",
    );
  });

  test("the *_rate family becomes AVG(x::INT)", () => {
    expect(
      convertedSelect(
        "win_rate, surrender_rate, early_surrender_rate, first_blood_rate",
      ),
    ).toBe(
      "AVG(win::INT) AS win_rate, AVG(surrendered::INT) AS surrender_rate, " +
        "AVG(early_surrendered::INT) AS early_surrender_rate, " +
        "AVG(first_blood_kill::INT) AS first_blood_rate",
    );
  });

  test("counters sum their physical lake column", () => {
    expect(
      convertedSelect(
        "kills, damage_to_champions, damage_taken, lane_minions, control_wards_bought, healing",
      ),
    ).toBe(
      "SUM(kills) AS kills, " +
        "SUM(total_damage_dealt_to_champions) AS damage_to_champions, " +
        "SUM(total_damage_taken) AS damage_taken, " +
        "SUM(total_minions_killed) AS lane_minions, " +
        "SUM(vision_wards_bought_in_game) AS control_wards_bought, " +
        "SUM(total_heal) AS healing",
    );
  });

  test("multikills sums the four multikill columns", () => {
    expect(convertedSelect("multikills")).toBe(
      "SUM(double_kills + triple_kills + quadra_kills + penta_kills) AS multikills",
    );
  });

  test("peaks stay MAX, not SUM", () => {
    expect(convertedSelect("largest_multikill, longest_life_seconds")).toBe(
      "MAX(largest_multi_kill) AS largest_multikill, " +
        "MAX(longest_time_spent_living) AS longest_life_seconds",
    );
  });

  test("kda and cs_per_minute become the v2 macros", () => {
    expect(convertedSelect("kda, cs_per_minute")).toBe(
      "kda() AS kda, per_minute(creep_score) AS cs_per_minute",
    );
  });

  test("avg_game_duration divides the average by sixty", () => {
    expect(convertedSelect("avg_game_duration")).toBe(
      "AVG(game_duration_seconds) / 60 AS avg_game_duration",
    );
  });

  test("champion level and experience become plain averages", () => {
    expect(convertedSelect("avg_champion_level, avg_champion_experience")).toBe(
      "AVG(champ_level) AS avg_champion_level, " +
        "AVG(champ_experience) AS avg_champion_experience",
    );
  });

  test("the arena family reads placement", () => {
    expect(
      convertedSelect(
        "arena_games, average_placement, top_two_rate, first_place_rate",
      ),
    ).toBe(
      "COUNT(placement) AS arena_games, AVG(placement) AS average_placement, " +
        "AVG((placement <= 2)::INT) AS top_two_rate, " +
        "AVG((placement = 1)::INT) AS first_place_rate",
    );
  });

  test("arena rates keep percent display and Wilson evidence", () => {
    const plan = compileScoutQl(
      convertLegacyQueryText(legacy("top_two_rate", "ORDER BY top_two_rate")),
    );
    expect(plan.outputs[0]?.displayKind).toBe("percent");
    expect(plan.outputs[0]?.evidence.kind).toBe("rate");
  });

  test("duration counters keep a duration display", () => {
    const plan = compileScoutQl(
      convertLegacyQueryText(
        legacy("time_dead_seconds", "ORDER BY time_dead_seconds"),
      ),
    );
    expect(plan.outputs[0]?.displayKind).toBe("duration");
  });

  test("per_game becomes AVG and per_minute becomes the macro", () => {
    expect(
      convertedSelect(
        "per_game(gold_earned) AS gpg, per_minute(damage_to_champions) AS dpm",
        "ORDER BY gpg",
      ),
    ).toBe(
      "AVG(gold_earned) AS gpg, " +
        "per_minute(total_damage_dealt_to_champions) AS dpm",
    );
  });

  test("per_game over a derived value divides by the row count", () => {
    expect(convertedSelect("per_game(win_rate) AS wrpg", "ORDER BY wrpg")).toBe(
      "AVG(win::INT) / COUNT(*) AS wrpg",
    );
  });

  test("round and arithmetic survive with their alias", () => {
    expect(
      convertedSelect(
        "round(win_rate, 2) AS wr, kills + assists AS takedowns",
        "ORDER BY wr",
      ),
    ).toBe(
      "ROUND(AVG(win::INT), 2) AS wr, SUM(kills) + SUM(assists) AS takedowns",
    );
  });

  test("a rounded rate still displays as a percentage", () => {
    const plan = compileScoutQl(
      convertLegacyQueryText(legacy("round(win_rate, 2) AS wr", "ORDER BY wr")),
    );
    expect(plan.outputs[0]?.displayKind).toBe("percent");
    expect(plan.outputs[0]?.evidence.kind).toBe("rate");
  });
});

describe("time windows become WHERE conjuncts", () => {
  test("a legacy lookback predicate keeps its meaning in v2 spelling", () => {
    const rewritten = convertLegacyQueryText(legacy("games"));
    expect(rewritten).toContain(
      "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY",
    );
    expect(compileScoutQl(rewritten).timeWindow).toEqual({
      kind: "relative",
      amount: 30,
      unit: "day",
    });
  });

  test("DURING LAST N DAYS becomes a relative conjunct", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player DURING LAST 14 DAYS",
    );
    expect(rewritten).toContain(
      "WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 14 DAY",
    );
    expect(rewritten).not.toContain("DURING");
  });

  test("DURING BETWEEN … IN TIME ZONE becomes a calendar conjunct", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player " +
        "DURING BETWEEN '2026-01-01' AND '2026-02-01' IN TIME ZONE 'America/Los_Angeles'",
    );
    expect(rewritten).toContain(
      "(game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-02-01'",
    );
    expect(compileScoutQl(rewritten).timeWindow).toEqual({
      kind: "calendar",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      timezone: "America/Los_Angeles",
    });
  });

  test("DURING ALL TIME leaves no conjunct at all", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player DURING ALL TIME",
    );
    expect(rewritten).not.toContain("WHERE");
    expect(compileScoutQl(rewritten).timeWindow).toEqual({ kind: "unbounded" });
  });

  test("prematch queries bound observed_at, not game_creation_at", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT prematches FROM prematch_participants GROUP BY player DURING LAST 7 DAYS ORDER BY prematches DESC",
    );
    expect(rewritten).toContain(
      "observed_at >= CURRENT_TIMESTAMP - INTERVAL 7 DAY",
    );
  });

  test("rank snapshots drop the timestamp predicate the engine ignored", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT player, score FROM rank_current WHERE " +
        LOOKBACK +
        " GROUP BY player ORDER BY score DESC",
    );
    expect(rewritten).not.toContain("game_creation_at");
    expect(compileScoutQl(rewritten).timeWindow).toEqual({ kind: "snapshot" });
  });
});

describe("ANALYZE becomes a window plus a DATE_TRUNC grouping", () => {
  test("BUCKET BY AUTO is resolved concretely at migration time", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player " +
        "ANALYZE LAST 30 DAYS BUCKET BY AUTO IN TIME ZONE 'Europe/Warsaw'",
    );
    // 30 days resolves to daily buckets; the migrated query says so out loud
    // rather than carrying a rule the v2 language no longer has.
    expect(rewritten).toContain(
      "GROUP BY player, DATE_TRUNC('day', game_creation_at AT TIME ZONE 'Europe/Warsaw')",
    );
    expect(rewritten).not.toContain("ANALYZE");
  });

  test("a 200-day window resolves AUTO to weekly buckets", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player ANALYZE LAST 200 DAYS",
    );
    expect(rewritten).toContain("DATE_TRUNC('week', game_creation_at)");
  });

  test("BUCKET BY PATCH becomes a plain patch grouping", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player ANALYZE LAST 30 DAYS BUCKET BY PATCH",
    );
    expect(rewritten).toContain("GROUP BY player, patch");
  });

  test("COMPARE TO PREVIOUS PERIOD becomes a render option", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player " +
        "ANALYZE LAST 30 DAYS BUCKET BY WEEK COMPARE TO PREVIOUS PERIOD " +
        "RENDER line_chart WITH (y = games)",
    );
    expect(rewritten).toContain("compare = previous_period");
    const plan = compileScoutQl(rewritten);
    expect("options" in plan.render ? plan.render.options : {}).toMatchObject({
      compare: "previous_period",
    });
  });

  test("a legacy temporal GROUP BY becomes DATE_TRUNC in UTC", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE ${LOOKBACK} GROUP BY week`,
    );
    expect(rewritten).toContain(
      "GROUP BY DATE_TRUNC('week', game_creation_at)",
    );
  });
});

describe("groupings, floors, and ordering", () => {
  test("pair becomes group(2) and player_pairs becomes player_groups", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM player_pairs WHERE ${LOOKBACK} GROUP BY pair`,
    );
    expect(rewritten).toContain("FROM player_groups");
    expect(rewritten).toContain("GROUP BY group(2)");
  });

  test("group(all) survives unchanged", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM player_groups WHERE ${LOOKBACK} GROUP BY group(all)`,
    );
    expect(rewritten).toContain("GROUP BY group(all)");
  });

  test("GROUP BY all becomes a grand total with no GROUP BY", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE ${LOOKBACK} GROUP BY all`,
    );
    expect(rewritten).not.toContain("GROUP BY");
    expect(compileScoutQl(rewritten).groupings).toEqual([]);
  });

  test("WHERE games >= n becomes a HAVING floor", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games, win_rate FROM match_participants WHERE ${LOOKBACK} AND games >= 10 GROUP BY player ORDER BY win_rate DESC`,
    );
    expect(rewritten).toContain("HAVING games >= 10");
    expect(rewritten).not.toContain("AND games >= 10");
  });

  test("a games floor without a games output counts rows directly", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT win_rate FROM match_participants WHERE ${LOOKBACK} AND games >= 5 GROUP BY player ORDER BY win_rate DESC`,
    );
    expect(rewritten).toContain("HAVING COUNT(*) >= 5");
  });

  test("an existing HAVING clause keeps its conjuncts", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games, win_rate FROM match_participants WHERE ${LOOKBACK} AND games >= 10 GROUP BY player HAVING win_rate > 0.5 ORDER BY win_rate DESC`,
    );
    expect(rewritten).toContain("HAVING games >= 10 AND win_rate > 0.5");
  });

  test("ORDER BY a grouping dimension targets the grouping", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE ${LOOKBACK} GROUP BY champion ORDER BY champion ASC`,
    );
    expect(rewritten).toContain("ORDER BY champion ASC");
    expect(compileScoutQl(rewritten).orderBy).toEqual([
      { target: { kind: "grouping", index: 0 }, direction: "asc" },
    ]);
  });

  test("an omitted ORDER BY is stated explicitly", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE ${LOOKBACK} GROUP BY player`,
    );
    expect(rewritten).toContain("ORDER BY games DESC");
  });

  test("an explicit LIMIT is left exactly where its author put it", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE ${LOOKBACK} GROUP BY player ORDER BY games DESC LIMIT 42`,
    );
    expect(rewritten).toContain("ORDER BY games DESC LIMIT 42");
    expect(compileScoutQl(rewritten).limit).toBe(42);
  });

  test("splices survive odd whitespace and keywords inside strings", () => {
    // The clause spans come from the legacy parser, so `'group by'` is a
    // string value and the newline inside `GROUP  \n BY` is just whitespace.
    // A regex over raw text gets both of these wrong.
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE queue IN ('group by') AND ${LOOKBACK} GROUP  \n BY all`,
    );
    expect(rewritten).toContain("queue IN ('group by')");
    expect(compileScoutQl(rewritten).groupings).toEqual([]);
  });

  test("a non-default limit the legacy compiler inferred is written out", () => {
    const rewritten = convertLegacyQueryText(
      "SELECT games FROM match_participants GROUP BY player " +
        "ANALYZE LAST 30 DAYS BUCKET BY DAY RENDER line_chart WITH (y = games)",
    );
    expect(compileScoutQl(rewritten).limit).toBe(2000);
  });
});

describe("filters", () => {
  test("queue values are canonicalised to the lake's lowercase", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE queue IN ('Solo', 'FLEX') AND ${LOOKBACK} GROUP BY player`,
    );
    expect(rewritten).toContain("queue IN ('solo', 'flex')");
  });

  test("Riot-cased text columns are canonicalised to uppercase", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE team_position = 'jungle' AND ${LOOKBACK} GROUP BY player`,
    );
    expect(rewritten).toContain("team_position = 'JUNGLE'");
  });

  test("champion('…') keeps the name its author wrote", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE champion_id = champion('Jinx') AND ${LOOKBACK} GROUP BY player`,
    );
    expect(rewritten).toContain("champion_id = champion('Jinx')");
  });

  test("player('…') stays an unresolved reference", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE player = player('Bob') AND ${LOOKBACK} GROUP BY champion`,
    );
    expect(rewritten).toContain("player = player('Bob')");
    expect(compileScoutQl(rewritten).playerRefs).toEqual(["Bob"]);
  });

  test("a boolean filter survives", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM match_participants WHERE win = true AND ${LOOKBACK} GROUP BY player`,
    );
    expect(rewritten).toContain("win = true");
  });

  test("competition_id stays a top-level condition and is lifted", () => {
    const rewritten = convertLegacyQueryText(
      `SELECT games FROM competition_match_participants WHERE competition_id = 12 AND ${LOOKBACK} GROUP BY player`,
    );
    expect(rewritten).toContain("competition_id = 12");
    expect(compileScoutQl(rewritten).competitionId).toBe(12);
  });
});

describe("queries the migration refuses", () => {
  test("COMPARE TO BETWEEN has no v2 equivalent", () => {
    const reason = refusal(
      "SELECT games FROM match_participants GROUP BY player " +
        "ANALYZE LAST 30 DAYS COMPARE TO BETWEEN '2025-01-01' AND '2025-01-30' " +
        "RENDER line_chart WITH (y = games)",
    );
    expect(reason).toContain("previous_period only");
  });

  test("a query the legacy parser cannot read is refused", () => {
    expect(
      refusal("SELECT games FROM match_participants ORDER BY games"),
    ).toContain("legacy parse failed");
  });

  test("a query the legacy compiler rejects is refused", () => {
    expect(
      refusal(
        "SELECT games FROM match_participants GROUP BY all DURING LAST FORTNIGHT",
      ),
    ).toContain("legacy compile failed");
  });

  test("a case-unknowable text equality is refused rather than guessed", () => {
    const reason = refusal(
      `SELECT games FROM match_participants WHERE player = 'someone' AND ${LOOKBACK} GROUP BY champion`,
    );
    expect(reason).toContain("case");
    expect(reason).toContain("by hand");
  });

  test("COMPARE TO PREVIOUS PERIOD on a non-chart render is refused", () => {
    const reason = refusal(
      "SELECT games FROM match_participants GROUP BY player " +
        "ANALYZE LAST 30 DAYS COMPARE TO PREVIOUS PERIOD RENDER leaderboard",
    );
    expect(reason).toContain("compare = previous_period");
  });

  test("an implicit ordering over a value the report never showed is refused", () => {
    // Legacy fell back to `ORDER BY games DESC` and read the raw row count
    // even when `games` was not selected. v2 orders by an output or a
    // grouping, and inventing a `games` column would change what the report
    // displays — so this is a decision for whoever owns the report.
    const reason = refusal(
      `SELECT win_rate FROM match_participants WHERE ${LOOKBACK} GROUP BY player`,
    );
    expect(reason).toContain("ORDER BY games");
  });

  test("the refusal is an UnconvertibleQueryError, not a crash", () => {
    expect(() =>
      convertLegacyQueryText("SELECT games FROM match_participants"),
    ).toThrow(UnconvertibleQueryError);
  });
});

// ── The command ──────────────────────────────────────────────────────────────

describe("migrate-scoutql-v2", () => {
  test("reports without writing, then writes with --fix, then is a no-op", async () => {
    const database = await temporaryDatabase("fix");
    const first = CORPUS_ROWS[0];
    const second = CORPUS_ROWS[2];
    if (first === undefined || second === undefined) {
      throw new Error("The corpus fixture lost its rows.");
    }
    await insertReports(database, [
      {
        id: first.id,
        title: "Competition activity",
        queryText: first.queryText,
      },
      {
        id: second.id,
        title: "Surrender leaders",
        queryText: second.queryText,
      },
    ]);

    const dryRun = await runMigration(database, false);
    expect(dryRun.exitCode).toBe(1);
    expect(dryRun.output).toContain("Re-run with --fix");
    expect((await readReports(database)).map((row) => row.queryText)).toEqual([
      first.queryText,
      second.queryText,
    ]);

    const fixed = await runMigration(database, true);
    expect(fixed.exitCode).toBe(0);
    expect(fixed.output).toContain("Rewrote 2 reports.");
    for (const row of await readReports(database)) {
      expect(row.queryText).not.toBe(first.queryText);
      expect(() => compileScoutQl(row.queryText)).not.toThrow();
    }

    const secondRun = await runMigration(database, true);
    expect(secondRun.exitCode).toBe(0);
    expect(secondRun.output).toContain("already v2:       2");
    expect(secondRun.output).toContain("to rewrite:       0");
  });

  test("fails startup by name when a row cannot be migrated", async () => {
    const database = await temporaryDatabase("refuse");
    const convertible = CORPUS_ROWS[0];
    if (convertible === undefined) {
      throw new Error("The corpus fixture lost its rows.");
    }
    await insertReports(database, [
      {
        id: 12,
        title: "Competition activity",
        queryText: convertible.queryText,
      },
      {
        id: 77,
        title: "Baseline against a fixed period",
        queryText:
          "SELECT games FROM match_participants GROUP BY player " +
          "ANALYZE LAST 30 DAYS COMPARE TO BETWEEN '2025-01-01' AND '2025-01-30' " +
          "RENDER line_chart WITH (y = games)",
      },
    ]);

    const result = await runMigration(database, true);

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("[77] Baseline against a fixed period");
    expect(result.output).toContain("previous_period only");
    expect(result.output).toContain("Nothing was rewritten");
    // All or nothing: the refusal already stops startup, so the convertible
    // row beside it is left alone too rather than leaving the database half in
    // each language.
    expect((await readReports(database)).map((row) => row.queryText)).toEqual([
      convertible.queryText,
      expect.stringContaining("COMPARE TO BETWEEN"),
    ]);
  });

  test("migrates the whole captured corpus in one boot, then in zero", async () => {
    // The acceptance criterion for the cutover: every report that exists in
    // beta and prod today survives a single unattended startup.
    const database = await temporaryDatabase("corpus");
    await insertReports(
      database,
      CORPUS_ROWS.map((row, index) => ({
        id: index + 1,
        title: `${row.env} report ${row.id.toString()}`,
        queryText: row.queryText,
      })),
    );

    const first = await runMigration(database, true);
    expect(first.exitCode).toBe(0);
    expect(first.output).toContain("Rewrote 15 reports.");
    for (const row of await readReports(database)) {
      expect(() => compileScoutQl(row.queryText)).not.toThrow();
    }

    const second = await runMigration(database, true);
    expect(second.exitCode).toBe(0);
    expect(second.output).toContain("already v2:       15");
    expect(second.output).toContain("to rewrite:       0");
  });

  test("leaves an already-migrated database untouched", async () => {
    const database = await temporaryDatabase("noop");
    const row = CORPUS_ROWS[9];
    if (row === undefined) throw new Error("The corpus fixture lost its rows.");
    const migrated = convertLegacyQueryText(row.queryText);
    await insertReports(database, [
      { id: 5, title: "KDA table", queryText: migrated },
    ]);

    const result = await runMigration(database, true);

    expect(result.exitCode).toBe(0);
    expect((await readReports(database))[0]?.queryText).toBe(migrated);
  });
});
