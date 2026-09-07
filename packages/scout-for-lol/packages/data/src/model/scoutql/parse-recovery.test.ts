import { describe, expect, test } from "vitest";
import { REPORT_QUERY_MAX_LENGTH } from "#src/model/reports/report.ts";
import {
  SCOUTQL_MAX_EXPRESSION_DEPTH,
  SCOUTQL_MAX_EXPRESSION_NODES,
} from "#src/model/scoutql/cst-to-ast-shared.ts";
import { parseScoutQl } from "#src/model/scoutql/parse.ts";

// A representative corpus in the NEW syntax. Every recovery/fuzz property in
// this file is checked against each of these.
const SAMPLES: readonly string[] = [
  "SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate FROM match_participants " +
    "WHERE queue IN ('solo','flex') AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
    "GROUP BY player HAVING games >= 10 ORDER BY win_rate DESC LIMIT 10 RENDER leaderboard",
  "SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games " +
    "FROM match_participants GROUP BY DATE_TRUNC('week', game_creation_at) RENDER line_chart",
  "SELECT COUNT(*) FILTER (WHERE win) AS wins, COUNT(*) AS games FROM match_participants GROUP BY ALL",
  "-- weekly cs\nSELECT PER_MINUTE(creep_score) AS cs_per_minute FROM match_participants -- tail",
  "SELECT QUANTILE_CONT(damage_to_champions, 0.9) AS p90 FROM match_participants " +
    "WHERE deaths IS NOT NULL AND kills BETWEEN 1 AND 20 AND NOT (queue = 'solo' OR queue = 'flex')",
  "SELECT COUNT(*) AS games FROM player_groups GROUP BY group(all) RENDER bar_chart " +
    "WITH (y = games, colors = (#aabbcc, #ddeeff), format = (games = 'count'), compare = previous_period)",
  "SELECT champion, COUNT(*) AS games FROM match_participants " +
    "WHERE (game_creation_at AT TIME ZONE 'America/Los_Angeles')::DATE BETWEEN '2026-01-01' AND '2026-02-01' " +
    "GROUP BY champion ORDER BY games DESC LIMIT 5",
  "SELECT player('Bob') AS p, kda() AS kda FROM match_participants WHERE champion = 'Kai''Sa'",
];

function isCompleteEnough(text: string): boolean {
  const result = parseScoutQl(text);
  return (
    result.diagnostics.length > 0 ||
    (result.ast.select !== undefined && result.ast.from !== undefined)
  );
}

describe("prefix truncation recovery", () => {
  for (const [index, sample] of SAMPLES.entries()) {
    test(`sample ${String(index)}: every prefix parses to an AST and either diagnoses or is complete`, () => {
      for (let cut = 0; cut <= sample.length; cut++) {
        const prefix = sample.slice(0, cut);
        const result = parseScoutQl(prefix);
        expect(result.ast.span).toEqual({ start: 0, end: prefix.length });
        expect(isCompleteEnough(prefix)).toBe(true);
      }
    });
  }

  test("SELECT FROM x keeps the source and diagnoses the missing item", () => {
    const result = parseScoutQl("SELECT FROM x");
    expect(result.ast.select).toEqual({
      items: [],
      span: { start: 0, end: 6 },
    });
    expect(result.ast.from?.source).toBe("x");
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "parse-error",
      ),
    ).toBe(true);
  });

  test("SELECT FROM x GROUP BY yields a partial AST with two diagnostics", () => {
    const result = parseScoutQl("SELECT FROM x GROUP BY");
    expect(result.ast.from?.source).toBe("x");
    expect(result.ast.groupBy).toEqual({
      all: false,
      items: [],
      span: { start: 14, end: 22 },
    });
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
  });

  test("empty input diagnoses both missing clauses", () => {
    const result = parseScoutQl("");
    expect(result.ast).toEqual({ span: { start: 0, end: 0 } });
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(["parse-error", "parse-error"]);
  });

  test("a duplicated clause diagnoses at the duplicate", () => {
    const text = "SELECT a FROM x WHERE p WHERE q";
    const result = parseScoutQl(text);
    expect(result.ast.where).toBeDefined();
    const [diagnostic] = result.diagnostics;
    expect(diagnostic?.code).toBe("parse-error");
    expect(diagnostic?.span).toEqual({
      start: text.indexOf("WHERE q"),
      end: text.indexOf("WHERE q") + "WHERE".length,
    });
  });

  test("a dangling LIMIT omits the clause instead of inventing a value", () => {
    const result = parseScoutQl("SELECT g FROM t LIMIT");
    expect(result.ast.limit).toBeUndefined();
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  test("clause-only input still reports missing SELECT and FROM", () => {
    const result = parseScoutQl("RENDER leaderboard");
    expect(result.ast.render?.kind).toBe("leaderboard");
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(["parse-error", "parse-error"]);
  });
});

// mulberry32 — tiny seeded PRNG so the fuzz corpus is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("never-throws fuzz", () => {
  const alphabet = "'\"()*,%::<>=!#-. \nSELECTWHEREandor0123456789";

  test("seeded byte-splices of every sample parse without throwing", () => {
    const random = mulberry32(0xc0_ff_ee);
    for (const sample of SAMPLES) {
      for (let round = 0; round < 200; round++) {
        let mutated = sample;
        const operations = 1 + Math.floor(random() * 3);
        for (let op = 0; op < operations; op++) {
          const at = Math.floor(random() * (mutated.length + 1));
          const to = Math.min(mutated.length, at + Math.floor(random() * 24));
          const roll = random();
          if (roll < 0.4) {
            mutated = mutated.slice(0, at) + mutated.slice(to);
          } else if (roll < 0.7) {
            mutated =
              mutated.slice(0, at) +
              mutated.slice(at, to) +
              mutated.slice(at, to) +
              mutated.slice(to);
          } else {
            const char =
              alphabet[Math.floor(random() * alphabet.length)] ?? "?";
            mutated = mutated.slice(0, at) + char + mutated.slice(at);
          }
        }
        const result = parseScoutQl(mutated);
        expect(Array.isArray(result.diagnostics)).toBe(true);
        expect(result.ast.span.start).toBe(0);
      }
    }
  });
});

describe("diagnostic spans", () => {
  test("double-quoted string", () => {
    const text = `SELECT COUNT(*) AS g FROM t WHERE queue = "solo"`;
    const result = parseScoutQl(text);
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === "string-double-quoted",
    );
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.span).toEqual({
      start: text.indexOf('"solo"'),
      end: text.indexOf('"solo"') + '"solo"'.length,
    });
  });

  test("CASE is rejected with a targeted diagnostic pointing at FILTER", () => {
    const text = "SELECT CASE WHEN win THEN 1 END AS x FROM t";
    const result = parseScoutQl(text);
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === "case-unsupported",
    );
    expect(diagnostic?.span).toEqual({
      start: text.indexOf("CASE"),
      end: text.indexOf("CASE") + "CASE".length,
    });
    expect(diagnostic?.message).toContain("FILTER");
  });

  test("unterminated string spans from the quote to the end", () => {
    const text = "SELECT COUNT(*) AS g FROM t WHERE queue = 'solo";
    const result = parseScoutQl(text);
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === "lex-error",
    );
    expect(diagnostic?.span).toEqual({
      start: text.indexOf("'solo"),
      end: text.length,
    });
    // The unterminated literal still participates in the parse as a string.
    expect(result.ast.where?.expr).toMatchObject({
      kind: "binary",
      op: "=",
      right: { kind: "string", value: "solo" },
    });
  });

  test("unknown character", () => {
    const text = "SELECT a FROM t WHERE b = $";
    const result = parseScoutQl(text);
    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.code === "lex-error",
    );
    expect(diagnostic?.span).toEqual({
      start: text.indexOf("$"),
      end: text.indexOf("$") + 1,
    });
  });

  test("query-too-long returns early with the whole-text span", () => {
    const text = `SELECT ${"a".repeat(REPORT_QUERY_MAX_LENGTH)} FROM t`;
    expect(text.length).toBeGreaterThan(REPORT_QUERY_MAX_LENGTH);
    const result = parseScoutQl(text);
    expect(result.tokens).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "query-too-long",
      severity: "error",
      span: { start: 0, end: text.length },
    });
  });

  test("diagnostics are sorted by span start", () => {
    const text = `SELECT "a" AS x FROM t WHERE b = "c" AND CASE`;
    const result = parseScoutQl(text);
    const starts = result.diagnostics.map(
      (diagnostic) => diagnostic.span.start,
    );
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);
  });
});

describe("depth and size caps", () => {
  test("prefix-operator chains beyond the depth cap diagnose expression-too-deep", () => {
    const nots = "NOT ".repeat(SCOUTQL_MAX_EXPRESSION_DEPTH + 1);
    const result = parseScoutQl(`SELECT ${nots}win AS x FROM t`);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("expression-too-deep");
  });

  test("pathological paren nesting is refused before the parse", () => {
    const depth = 33;
    const text = `SELECT ${"(".repeat(depth)}1${")".repeat(depth)} AS x FROM t`;
    const result = parseScoutQl(text);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.code === "expression-too-deep",
      ),
    ).toBe(true);
    // Guarded input skips the parse entirely — no partial clauses.
    expect(result.ast.select).toBeUndefined();
  });

  test("moderate paren nesting parses fine", () => {
    const depth = 8;
    const text = `SELECT ${"(".repeat(depth)}1${")".repeat(depth)} AS x FROM t`;
    const result = parseScoutQl(text);
    expect(result.diagnostics).toEqual([]);
    expect(result.ast.select?.items[0]?.expr).toMatchObject({
      kind: "number",
      value: 1,
    });
  });

  test("more than the node budget diagnoses expression-too-large", () => {
    const items = Array.from(
      { length: SCOUTQL_MAX_EXPRESSION_NODES + 100 },
      () => "a",
    ).join(", ");
    const result = parseScoutQl(`SELECT ${items} FROM t`);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("expression-too-large");
  });

  test("caps do not fire for a realistic wide query", () => {
    const conjuncts = Array.from(
      { length: 30 },
      (_unused, index) => `c${String(index)} = ${String(index)}`,
    ).join(" AND ");
    const result = parseScoutQl(
      `SELECT COUNT(*) AS g FROM t WHERE ${conjuncts}`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
