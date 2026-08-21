import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import {
  compileGroupFactsQuery,
  compileMatchQuery,
  compilePrematchQuery,
  type LakeQueryInput,
} from "#src/reports/duckdb/compile.ts";
import {
  buildPredictionObservationsSource,
  type LakeFiles,
} from "#src/reports/duckdb/lake.ts";
import { guildScope } from "#src/reports/duckdb/scope.ts";
import {
  TEST_GUILD_ID,
  TEST_LAKE_FILES,
  paramValues,
} from "#src/testing/test-lake-files.ts";

function input(queryText: string, playerIds?: number[]): LakeQueryInput {
  return {
    plan: parseAndCompile(queryText),
    scope: guildScope(TEST_GUILD_ID),
    startMs: 1_700_000_000_000,
    endMs: 1_700_600_000_000,
    ...(playerIds === undefined ? {} : { playerIds }),
    files: TEST_LAKE_FILES,
  };
}

describe("compile", () => {
  test("prediction observations prefer newer staging rows over compacted parquet", () => {
    const source = buildPredictionObservationsSource(
      {
        matchesParquet: [],
        matchesStaging: [],
        prematchParquet: [],
        prematchStaging: [],
        predictionObservationsParquet: ["published.parquet"],
        predictionObservationsStaging: ["pending.ndjson"],
        accountsParquet: undefined,
        competitionRankHistoryParquet: [],
        competitionRankHistoryStaging: [],
      },
      { sql: "", params: [] },
    );
    if (source === undefined) {
      throw new Error("expected prediction observation source");
    }
    expect(source.sql).toContain(
      "PARTITION BY match_id ORDER BY observed_at DESC, src DESC",
    );
  });

  test("match query: filters pushed into both union branches before dedupe", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT player, games FROM match_participants WHERE queue IN ('solo') GROUP BY player DURING LAST 30 DAYS",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    // Both branches (parquet + staging) carry the predicate, so it appears
    // twice, and the dedupe QUALIFY wraps the unioned source.
    const occurrences =
      compiled.aggregateSql.split("queue IN (SELECT unnest(?))").length - 1;
    expect(occurrences).toBe(2);
    expect(compiled.aggregateSql).toContain("UNION ALL BY NAME");
    expect(compiled.aggregateSql).toContain(
      "PARTITION BY match_id, puuid ORDER BY src",
    );
    // The dedupe must wrap a subquery that already contains the WHERE.
    expect(
      compiled.aggregateSql.indexOf("queue IN (SELECT unnest(?))"),
    ).toBeLessThan(compiled.aggregateSql.indexOf("QUALIFY"));
  });

  test("injection fuzz: hostile filter values never reach SQL text", () => {
    // The ScoutQL lexer already rejects strings like this, but the compiler
    // must not rely on that: feed a hostile plan value directly.
    const hostile = "solo'); DROP TABLE reports;--";
    const base = input(
      "SELECT player, games FROM match_participants WHERE queue IN ('solo') GROUP BY player DURING LAST 30 DAYS",
    );
    const compiled = compileMatchQuery({
      ...base,
      plan: { ...base.plan, queueFilter: [hostile] },
    });
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).not.toContain("DROP TABLE");
    expect(compiled.scannedSql).not.toContain("DROP TABLE");
    expect(paramValues(compiled.aggregateParams)).toContain(hostile);
  });

  test("competition scoping binds player ids as a list param", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT player, games FROM competition_match_participants WHERE competition_id = 1 GROUP BY player DURING LAST 30 DAYS",
        [7, 8, 9],
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain(
      "a.player_id IN (SELECT unnest(?))",
    );
    expect(paramValues(compiled.aggregateParams)).toEqual(
      expect.arrayContaining([7, 8, 9]),
    );
  });

  test("group query dedupes per subteam unit and keeps only multi-player units", () => {
    const compiled = compileGroupFactsQuery(
      input(
        "SELECT group, games FROM player_groups GROUP BY group(all) DURING LAST 30 DAYS",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    // Dedupe and unit scoping both key on the Arena-aware unit: (match,
    // team, subteam). Singleton units never leave DuckDB.
    expect(compiled.aggregateSql).toContain(
      "PARTITION BY match_id, team_id, player_subteam_id, player_id ORDER BY puuid",
    );
    expect(compiled.aggregateSql).toContain(
      "PARTITION BY match_id, team_id, player_subteam_id) >= 2",
    );
    // Raw fact rows, not SQL aggregation — combinations happen in JS.
    expect(compiled.aggregateSql).not.toContain("GROUP BY");
  });

  test("legacy pair query text compiles to the same group facts query", () => {
    const legacy = compileGroupFactsQuery(
      input(
        "SELECT pair, games FROM player_pairs GROUP BY pair DURING LAST 30 DAYS",
      ),
    );
    const modern = compileGroupFactsQuery(
      input(
        "SELECT group, games FROM player_groups GROUP BY group(2) DURING LAST 30 DAYS",
      ),
    );
    expect(legacy?.aggregateSql).toBe(modern?.aggregateSql);
  });

  test("prematch rowsScanned asymmetry: champion filter only in the aggregate statement", () => {
    const compiled = compilePrematchQuery(
      input(
        "SELECT player, prematches FROM prematch_participants WHERE champion_id = 22 GROUP BY player DURING LAST 30 DAYS",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain("champion_id = ?");
    expect(compiled.scannedSql).not.toContain("champion_id = ?");
    expect(compiled.aggregateParams.length).toBe(
      compiled.scannedParams.length + 1,
    );
  });

  test("prematch GROUP BY all: no trailing empty GROUP BY clause", () => {
    const compiled = compilePrematchQuery(
      input(
        "SELECT prematches FROM prematch_participants GROUP BY all DURING LAST 30 DAYS",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    // The `all` grouping has no group expressions; emitting a bare `GROUP BY`
    // would make DuckDB reject the report. Mirror the match path and collapse
    // to a whole-table aggregate guarded by HAVING instead.
    expect(compiled.aggregateSql).not.toContain("GROUP BY");
    expect(compiled.aggregateSql).toContain("HAVING COUNT(*) > 0");
  });
});

describe("compile temporal grouping", () => {
  test("prematch temporal grouping retains the observation timestamp", () => {
    const compiled = compilePrematchQuery(
      input(
        "SELECT prematches FROM prematch_participants GROUP BY all ANALYZE LAST 30 DAYS BUCKET BY DAY IN TIME ZONE 'UTC'",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain("p.observed_at FROM");
    expect(compiled.aggregateSql).toContain("date_trunc('day', observed_at)");
  });

  test("match rowsScanned parity: champion filter in BOTH statements", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT player, games FROM match_participants WHERE champion_id = 22 GROUP BY player DURING LAST 30 DAYS",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain("champion_id = ?");
    expect(compiled.scannedSql).toContain("champion_id = ?");
  });

  test("compiles two-dimensional temporal grouping as closed SQL", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT games, win_rate FROM match_participants GROUP BY week, team_position DURING LAST 30 DAYS ORDER BY label ASC",
      ),
    );
    if (compiled === undefined) throw new Error("expected compiled query");
    expect(compiled.aggregateSql).toContain(
      "date_trunc('week', game_creation_at)",
    );
    expect(compiled.aggregateSql).toContain("team_position");
    expect(compiled.aggregateSql).toContain("concat_ws(' • '");
  });

  test("uses a DURING calendar timezone for match grouping", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT games FROM match_participants GROUP BY day DURING BETWEEN '2026-01-01' AND '2026-01-02' IN TIME ZONE 'America/Los_Angeles'",
      ),
    );
    if (compiled === undefined) throw new Error("expected compiled query");
    expect(compiled.aggregateSql).toContain(
      "timezone(?, timezone('UTC', game_creation_at))",
    );
    expect(paramValues(compiled.aggregateParams)).toContain(
      "America/Los_Angeles",
    );
  });

  test("binds string, numeric, and boolean participant filters", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT games FROM match_participants WHERE role = 'support' AND damage_to_champions >= 10000 AND win IN (true, false) GROUP BY player DURING LAST 30 DAYS",
      ),
    );
    if (compiled === undefined) throw new Error("expected compiled query");
    expect(compiled.aggregateSql).toContain("lower(role) = ?");
    expect(compiled.aggregateSql).toContain(
      "total_damage_dealt_to_champions >= ?",
    );
    expect(compiled.aggregateSql).toContain("(win = ? OR win = ?)");
    expect(paramValues(compiled.aggregateParams)).toEqual(
      expect.arrayContaining(["support", 10_000, true, false]),
    );
  });

  test("empty lake (no files) compiles to undefined for short-circuit", () => {
    const empty: LakeFiles = {
      matchesParquet: [],
      matchesStaging: [],
      prematchParquet: [],
      prematchStaging: [],
      predictionObservationsParquet: [],
      predictionObservationsStaging: [],
      accountsParquet: undefined,
      competitionRankHistoryParquet: [],
      competitionRankHistoryStaging: [],
    };
    const compiled = compileMatchQuery({
      ...input(
        "SELECT player, games FROM match_participants GROUP BY player DURING LAST 30 DAYS",
      ),
      files: empty,
    });
    expect(compiled).toBeUndefined();
  });
});
