import { describe, expect, test } from "bun:test";
import { parseAndCompile } from "@scout-for-lol/data";
import {
  compileGroupFactsQuery,
  compileMatchQuery,
  compilePrematchQuery,
  type LakeQueryInput,
} from "#src/reports/duckdb/compile.ts";
import type { BoundParam, LakeFiles } from "#src/reports/duckdb/lake.ts";

const FILES: LakeFiles = {
  matchesParquet: ["/lake/builds/b1/matches/month=2026-07/data_0.parquet"],
  matchesStaging: ["/lake/matches-recent/NA1_1.jsonl"],
  prematchParquet: ["/lake/builds/b1/prematch/month=2026-07/data_0.parquet"],
  prematchStaging: [],
  accountsParquet: "/lake/builds/b1/accounts/accounts.parquet",
};

function input(queryText: string, playerIds?: number[]): LakeQueryInput {
  return {
    plan: parseAndCompile(queryText),
    serverId: "guild-1",
    startMs: 1_700_000_000_000,
    endMs: 1_700_600_000_000,
    ...(playerIds === undefined ? {} : { playerIds }),
    files: FILES,
  };
}

function paramValues(params: BoundParam[]): (string | number)[] {
  return params.flatMap((param) =>
    param.kind === "scalar" ? [param.value] : [...param.values],
  );
}

describe("compile", () => {
  test("match query: filters pushed into both union branches before dedupe", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT player, games FROM match_participants WHERE queue IN ('solo') GROUP BY player",
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
      "SELECT player, games FROM match_participants WHERE queue IN ('solo') GROUP BY player",
    );
    const compiled = compileMatchQuery({
      ...base,
      plan: { ...base.plan, queueFilter: [hostile] },
      serverId: "guild'; DROP TABLE accounts;--",
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
        "SELECT player, games FROM competition_match_participants WHERE competition_id = 1 GROUP BY player",
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
      input("SELECT group, games FROM player_groups GROUP BY group(all)"),
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
      input("SELECT pair, games FROM player_pairs GROUP BY pair"),
    );
    const modern = compileGroupFactsQuery(
      input("SELECT group, games FROM player_groups GROUP BY group(2)"),
    );
    expect(legacy?.aggregateSql).toBe(modern?.aggregateSql);
  });

  test("prematch rowsScanned asymmetry: champion filter only in the aggregate statement", () => {
    const compiled = compilePrematchQuery(
      input(
        "SELECT player, prematches FROM prematch_participants WHERE champion_id = 22 GROUP BY player",
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

  test("match rowsScanned parity: champion filter in BOTH statements", () => {
    const compiled = compileMatchQuery(
      input(
        "SELECT player, games FROM match_participants WHERE champion_id = 22 GROUP BY player",
      ),
    );
    if (compiled === undefined) {
      throw new Error("expected compiled query");
    }
    expect(compiled.aggregateSql).toContain("champion_id = ?");
    expect(compiled.scannedSql).toContain("champion_id = ?");
  });

  test("empty lake (no files) compiles to undefined for short-circuit", () => {
    const empty: LakeFiles = {
      matchesParquet: [],
      matchesStaging: [],
      prematchParquet: [],
      prematchStaging: [],
      accountsParquet: undefined,
    };
    const compiled = compileMatchQuery({
      ...input("SELECT player, games FROM match_participants GROUP BY player"),
      files: empty,
    });
    expect(compiled).toBeUndefined();
  });
});
