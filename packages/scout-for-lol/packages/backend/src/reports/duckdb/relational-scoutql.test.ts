import { describe, expect, test } from "vitest";
import { validateRelationalScoutQl } from "#src/reports/duckdb/relational-scoutql.ts";

const TARGETS = ["virmel"];

const VALID_QUERY = `WITH candidate_games AS (
  SELECT p.match_id, p.game_end_at,
    p.creep_score * 60.0 / NULLIF(p.time_played, 0) >= 8
      AND p.time_played >= 1200 AS matched
  FROM match_participants AS p
  JOIN match_teams AS t
    ON t.match_id = p.match_id AND t.team_id = p.team_id
  WHERE p.puuid IN dare_target('virmel')
  ORDER BY p.game_end_at ASC, p.match_id ASC
  LIMIT 100
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM candidate_games WHERE matched IS TRUE
) THEN TRUE ELSE FALSE END AS achieved`;

describe("relational ScoutQL compiler", () => {
  test("canonically compiles bounded joins, CTEs, subqueries, and qualified columns", async () => {
    const result = await validateRelationalScoutQl({
      queryText: VALID_QUERY,
      allowedTargetKeys: TARGETS,
    });

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.compilation.canonicalScoutQl).toContain(
      "WITH candidate_games AS",
    );
    expect(result.compilation.canonicalScoutQl).toContain("AS achieved");
    expect(result.compilation.immutableAst).toContain('"statements"');
    expect(result.compilation.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.compilation.facts).toEqual({
      cteCount: 1,
      joinedRelations: 1,
      predicates: 7,
      maxExpressionDepth: 5,
      physicalSources: ["match_participants", "match_teams"],
      functions: ["*", "/", "contains", "dare_target", "nullif"],
      targetKeys: ["virmel"],
    });
  });

  test("produces an ingestion-order-independent immutable plan", async () => {
    const first = await validateRelationalScoutQl({
      queryText: VALID_QUERY,
      allowedTargetKeys: TARGETS,
    });
    const second = await validateRelationalScoutQl({
      queryText: VALID_QUERY.replaceAll("  ", "    "),
      allowedTargetKeys: TARGETS,
    });

    expect(first.kind).toBe("valid");
    expect(second.kind).toBe("valid");
    if (first.kind !== "valid" || second.kind !== "valid") return;
    expect(first.compilation.canonicalScoutQl).toBe(
      second.compilation.canonicalScoutQl,
    );
    expect(first.compilation.planHash).toBe(second.compilation.planHash);
  });

  test.each([
    [
      "multiple statements",
      `${VALID_QUERY}; DROP TABLE match_participants`,
      "exactly one SELECT statement",
    ],
    [
      "unlisted source",
      "SELECT EXISTS (SELECT 1 FROM read_parquet('private')) AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel')",
      "closed function catalog",
    ],
    [
      "unlisted function",
      "SELECT random() > 0 AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel')",
      "function random",
    ],
    [
      "wall clock",
      "SELECT current_timestamp > p.game_end_at AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel')",
      "wall-clock reference current_timestamp",
    ],
    [
      "dynamic target",
      "SELECT COUNT(*) > 0 AS achieved FROM match_participants p WHERE p.puuid IN dare_target('other')",
      "not a frozen dare target",
    ],
    [
      "recursive CTE",
      "WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM x WHERE n < 3) SELECT EXISTS (SELECT 1 FROM match_participants p WHERE p.puuid IN dare_target('virmel')) AS achieved FROM x",
      "Recursive CTEs",
    ],
    [
      "non-select statement",
      "COPY match_participants TO 'leak.parquet'",
      "one SELECT statement",
    ],
  ])("rejects %s", async (_name, queryText, expectedIssue) => {
    const result = await validateRelationalScoutQl({
      queryText,
      allowedTargetKeys: TARGETS,
    });

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.issues.join(" ")).toContain(expectedIssue);
  });

  test("rejects missing and extra result columns", async () => {
    const result = await validateRelationalScoutQl({
      queryText:
        "SELECT COUNT(*) AS games, TRUE AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel')",
      allowedTargetKeys: TARGETS,
    });

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.issues).toContain(
      "A Dare contract query must return exactly one achieved column.",
    );
  });

  test("does not treat a qualified physical source as a same-named CTE", async () => {
    const result = await validateRelationalScoutQl({
      queryText:
        "WITH match_participants AS (SELECT 1 AS value) SELECT EXISTS (SELECT 1 FROM main.match_participants p WHERE p.puuid IN dare_target('virmel')) AS achieved",
      allowedTargetKeys: TARGETS,
    });

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.issues).toContain(
      "ScoutQL source main.match_participants is not in the closed source catalog.",
    );
  });

  test.each([
    ["column argument", "dare_target(p.puuid)"],
    ["no arguments", "dare_target()"],
    ["multiple arguments", "dare_target('virmel', 'other')"],
  ])(
    "rejects a nonliteral dare_target %s even beside a valid call",
    async (_name, call) => {
      const result = await validateRelationalScoutQl({
        queryText: `SELECT COUNT(*) > 0 AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel') OR p.puuid IN ${call}`,
        allowedTargetKeys: TARGETS,
      });

      expect(result.kind).toBe("invalid");
      if (result.kind !== "invalid") return;
      expect(result.issues).toContain(
        "Every dare_target(...) call must contain exactly one string literal target key.",
      );
    },
  );

  test("rejects a non-Boolean achieved projection", async () => {
    const result = await validateRelationalScoutQl({
      queryText:
        "SELECT 1 AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel')",
      allowedTargetKeys: TARGETS,
    });

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.issues).toContain(
      "A Dare contract query must return achieved as a Boolean expression.",
    );
  });

  test("accepts a nullable Boolean achieved projection", async () => {
    const result = await validateRelationalScoutQl({
      queryText:
        "SELECT CASE WHEN COUNT(*) > 0 THEN TRUE ELSE NULL END AS achieved FROM match_participants p WHERE p.puuid IN dare_target('virmel')",
      allowedTargetKeys: TARGETS,
    });

    expect(result.kind).toBe("valid");
  });
});
