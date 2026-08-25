import { describe, expect, test } from "vitest";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlQueryAst } from "#src/model/scoutql/ast.ts";
import { parseScoutQl } from "#src/model/scoutql/parse.ts";

function spanOf(text: string, part: string, from = 0): ScoutQlSpan {
  const start = text.indexOf(part, from);
  if (start === -1) {
    throw new Error(`substring not found: ${part}`);
  }
  return { start, end: start + part.length };
}

function parseClean(text: string): ScoutQlQueryAst {
  const result = parseScoutQl(text);
  expect(result.diagnostics).toEqual([]);
  return result.ast;
}

const FLAGSHIP =
  "SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate " +
  "FROM match_participants " +
  "WHERE queue IN ('solo','flex') AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY " +
  "GROUP BY player HAVING games >= 10 ORDER BY win_rate DESC LIMIT 10 " +
  "RENDER leaderboard";

describe("flagship query — SELECT/FROM", () => {
  test("query span covers the whole text", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.span).toEqual({ start: 0, end: FLAGSHIP.length });
  });

  test("COUNT(*) AS games", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.select?.items[0]).toEqual({
      expr: {
        kind: "call",
        name: "count",
        star: true,
        distinct: false,
        all: false,
        args: [],
        span: spanOf(FLAGSHIP, "COUNT(*)"),
      },
      alias: "games",
      aliasSpan: spanOf(FLAGSHIP, "games"),
      span: spanOf(FLAGSHIP, "COUNT(*) AS games"),
    });
  });

  test("AVG(win::INT) AS win_rate — cast keeps operator form", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.select?.items[1]).toEqual({
      expr: {
        kind: "call",
        name: "avg",
        star: false,
        distinct: false,
        all: false,
        args: [
          {
            kind: "cast",
            operand: {
              kind: "column",
              name: "win",
              span: spanOf(FLAGSHIP, "win"),
            },
            to: "int",
            form: "operator",
            span: spanOf(FLAGSHIP, "win::INT"),
          },
        ],
        span: spanOf(FLAGSHIP, "AVG(win::INT)"),
      },
      alias: "win_rate",
      aliasSpan: spanOf(FLAGSHIP, "win_rate"),
      span: spanOf(FLAGSHIP, "AVG(win::INT) AS win_rate"),
    });
    expect(ast.select?.span).toEqual(
      spanOf(FLAGSHIP, "SELECT COUNT(*) AS games, AVG(win::INT) AS win_rate"),
    );
  });

  test("FROM names the source, lowercased", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.from).toEqual({
      source: "match_participants",
      span: spanOf(FLAGSHIP, "FROM match_participants"),
    });
  });
});

describe("flagship query — WHERE", () => {
  const wherePart =
    "queue IN ('solo','flex') AND game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY";

  test("clause span", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.where?.span).toEqual(spanOf(FLAGSHIP, `WHERE ${wherePart}`));
  });

  test("top-level AND of IN and a time bound, with exact spans", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.where?.expr).toEqual({
      kind: "binary",
      op: "and",
      left: {
        kind: "in",
        operand: {
          kind: "column",
          name: "queue",
          span: spanOf(FLAGSHIP, "queue"),
        },
        negated: false,
        items: [
          { kind: "string", value: "solo", span: spanOf(FLAGSHIP, "'solo'") },
          { kind: "string", value: "flex", span: spanOf(FLAGSHIP, "'flex'") },
        ],
        span: spanOf(FLAGSHIP, "queue IN ('solo','flex')"),
      },
      right: {
        kind: "binary",
        op: ">=",
        left: {
          kind: "column",
          name: "game_creation_at",
          span: spanOf(FLAGSHIP, "game_creation_at"),
        },
        right: {
          kind: "binary",
          op: "-",
          left: {
            kind: "now",
            which: "timestamp",
            span: spanOf(FLAGSHIP, "CURRENT_TIMESTAMP"),
          },
          right: {
            kind: "interval",
            amount: 30,
            unit: "day",
            form: "number",
            span: spanOf(FLAGSHIP, "INTERVAL 30 DAY"),
          },
          span: spanOf(FLAGSHIP, "CURRENT_TIMESTAMP - INTERVAL 30 DAY"),
        },
        span: spanOf(
          FLAGSHIP,
          "game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 30 DAY",
        ),
      },
      span: spanOf(FLAGSHIP, wherePart),
    });
  });
});

describe("flagship query — tail clauses", () => {
  test("GROUP BY player", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.groupBy).toEqual({
      all: false,
      items: [
        { kind: "column", name: "player", span: spanOf(FLAGSHIP, "player") },
      ],
      span: spanOf(FLAGSHIP, "GROUP BY player"),
    });
  });

  test("HAVING games >= 10", () => {
    const ast = parseClean(FLAGSHIP);
    const havingFrom = FLAGSHIP.indexOf("HAVING");
    expect(ast.having).toEqual({
      expr: {
        kind: "binary",
        op: ">=",
        left: {
          kind: "column",
          name: "games",
          span: spanOf(FLAGSHIP, "games", havingFrom),
        },
        right: {
          kind: "number",
          value: 10,
          span: spanOf(FLAGSHIP, "10", havingFrom),
        },
        span: spanOf(FLAGSHIP, "games >= 10"),
      },
      span: spanOf(FLAGSHIP, "HAVING games >= 10"),
    });
  });

  test("ORDER BY win_rate DESC", () => {
    const ast = parseClean(FLAGSHIP);
    const orderFrom = FLAGSHIP.indexOf("ORDER BY");
    expect(ast.orderBy).toEqual({
      keys: [
        {
          expr: {
            kind: "column",
            name: "win_rate",
            span: spanOf(FLAGSHIP, "win_rate", orderFrom),
          },
          direction: "desc",
          span: spanOf(FLAGSHIP, "win_rate DESC"),
        },
      ],
      span: spanOf(FLAGSHIP, "ORDER BY win_rate DESC"),
    });
  });

  test("LIMIT and RENDER", () => {
    const ast = parseClean(FLAGSHIP);
    expect(ast.limit).toEqual({
      value: 10,
      span: spanOf(FLAGSHIP, "LIMIT 10"),
    });
    expect(ast.render).toEqual({
      kind: "leaderboard",
      options: [],
      span: spanOf(FLAGSHIP, "RENDER leaderboard"),
    });
  });
});

describe("expressions", () => {
  test("DATE_TRUNC grouping query", () => {
    const text =
      "SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games " +
      "FROM match_participants GROUP BY DATE_TRUNC('week', game_creation_at) RENDER line_chart";
    const ast = parseClean(text);
    expect(ast.select?.items[0]?.expr).toEqual({
      kind: "call",
      name: "date_trunc",
      star: false,
      distinct: false,
      all: false,
      args: [
        { kind: "string", value: "week", span: spanOf(text, "'week'") },
        {
          kind: "column",
          name: "game_creation_at",
          span: spanOf(text, "game_creation_at"),
        },
      ],
      span: spanOf(text, "DATE_TRUNC('week', game_creation_at)"),
    });
    expect(ast.groupBy?.items).toHaveLength(1);
    expect(ast.groupBy?.items[0]?.kind).toBe("call");
    expect(ast.render?.kind).toBe("line_chart");
  });

  test("FILTER (WHERE …) suffix", () => {
    const text =
      "SELECT COUNT(*) FILTER (WHERE win) AS wins FROM match_participants";
    const ast = parseClean(text);
    expect(ast.select?.items[0]?.expr).toEqual({
      kind: "call",
      name: "count",
      star: true,
      distinct: false,
      all: false,
      args: [],
      filter: { kind: "column", name: "win", span: spanOf(text, "win") },
      span: spanOf(text, "COUNT(*) FILTER (WHERE win)"),
    });
  });

  test("OR/NOT/parens", () => {
    const text =
      "SELECT COUNT(*) AS g FROM t WHERE NOT (queue = 'solo' OR queue = 'flex')";
    const ast = parseClean(text);
    const secondQueue = spanOf(text, "queue", text.indexOf("OR"));
    expect(ast.where?.expr).toEqual({
      kind: "unary",
      op: "not",
      operand: {
        kind: "binary",
        op: "or",
        left: {
          kind: "binary",
          op: "=",
          left: { kind: "column", name: "queue", span: spanOf(text, "queue") },
          right: {
            kind: "string",
            value: "solo",
            span: spanOf(text, "'solo'"),
          },
          span: spanOf(text, "queue = 'solo'"),
        },
        right: {
          kind: "binary",
          op: "=",
          left: { kind: "column", name: "queue", span: secondQueue },
          right: {
            kind: "string",
            value: "flex",
            span: spanOf(text, "'flex'"),
          },
          span: spanOf(text, "queue = 'flex'"),
        },
        span: spanOf(text, "queue = 'solo' OR queue = 'flex'"),
      },
      span: spanOf(text, "NOT (queue = 'solo' OR queue = 'flex')"),
    });
  });

  test("IS NULL, IS NOT NULL, BETWEEN, NOT BETWEEN, NOT IN", () => {
    const text =
      "SELECT COUNT(*) AS g FROM t " +
      "WHERE a IS NULL AND b IS NOT NULL AND c BETWEEN 1 AND 10 " +
      "AND d NOT BETWEEN 2 AND 3 AND e NOT IN (4, 5)";
    const ast = parseClean(text);
    const conjuncts: { kind: string; negated?: boolean }[] = [];
    let expr = ast.where?.expr;
    while (expr?.kind === "binary" && expr.op === "and") {
      conjuncts.unshift(expr.right);
      expr = expr.left;
    }
    if (expr !== undefined) {
      conjuncts.unshift(expr);
    }
    expect(
      conjuncts.map((conjunct) => [conjunct.kind, conjunct.negated]),
    ).toEqual([
      ["is-null", false],
      ["is-null", true],
      ["between", false],
      ["between", true],
      ["in", true],
    ]);
  });

  test("LIKE, ILIKE, and NOT LIKE (negation wraps in unary not)", () => {
    const like = parseClean("SELECT 1 AS x FROM t WHERE name LIKE 'a%'");
    expect(like.where?.expr.kind).toBe("binary");
    const ilike = parseClean("SELECT 1 AS x FROM t WHERE name ILIKE 'a%'");
    const ilikeExpr = ilike.where?.expr;
    expect(ilikeExpr?.kind === "binary" && ilikeExpr.op).toBe("ilike");
    const notLike = parseClean("SELECT 1 AS x FROM t WHERE name NOT LIKE 'a%'");
    const notLikeExpr = notLike.where?.expr;
    if (notLikeExpr?.kind !== "unary") {
      throw new Error("expected unary not around NOT LIKE");
    }
    expect(notLikeExpr.op).toBe("not");
    expect(
      notLikeExpr.operand.kind === "binary" && notLikeExpr.operand.op,
    ).toBe("like");
  });
});

describe("expression forms and literals", () => {
  test("AT TIME ZONE and ::DATE postfix chain", () => {
    const text =
      "SELECT COUNT(*) AS g FROM t WHERE (ts AT TIME ZONE 'America/Los_Angeles')::DATE " +
      "BETWEEN '2026-01-01' AND '2026-02-01'";
    const ast = parseClean(text);
    const where = ast.where?.expr;
    if (where?.kind !== "between") {
      throw new Error("expected BETWEEN");
    }
    expect(where.operand).toEqual({
      kind: "cast",
      operand: {
        kind: "binary",
        op: "at-time-zone",
        left: { kind: "column", name: "ts", span: spanOf(text, "ts") },
        right: {
          kind: "string",
          value: "America/Los_Angeles",
          span: spanOf(text, "'America/Los_Angeles'"),
        },
        span: spanOf(text, "ts AT TIME ZONE 'America/Los_Angeles'"),
      },
      to: "date",
      form: "operator",
      span: spanOf(text, "ts AT TIME ZONE 'America/Los_Angeles')::DATE"),
    });
  });

  test("string '' escaping decodes", () => {
    const text = "SELECT COUNT(*) AS g FROM t WHERE champion = 'Kai''Sa'";
    const ast = parseClean(text);
    const where = ast.where?.expr;
    if (where?.kind !== "binary") {
      throw new Error("expected compare");
    }
    expect(where.right).toEqual({
      kind: "string",
      value: "Kai'Sa",
      span: spanOf(text, "'Kai''Sa'"),
    });
  });

  test("INTERVAL forms", () => {
    const stringForm = parseClean("SELECT INTERVAL '30 days' AS i FROM t");
    expect(stringForm.select?.items[0]?.expr).toMatchObject({
      kind: "interval",
      amount: 30,
      unit: "days",
      form: "string",
    });
    const bareNumber = parseClean("SELECT INTERVAL 5 AS i FROM t");
    expect(bareNumber.select?.items[0]?.expr).toMatchObject({
      kind: "interval",
      amount: 5,
      unit: null,
      form: "number",
    });
    const unparseable = parseClean("SELECT INTERVAL 'bogus' AS i FROM t");
    expect(unparseable.select?.items[0]?.expr).toMatchObject({
      kind: "interval",
      amount: null,
      unit: null,
      form: "string",
    });
  });

  test("CAST(x AS INT) keeps function form", () => {
    const text = "SELECT CAST(win AS INT) AS w FROM t";
    const ast = parseClean(text);
    expect(ast.select?.items[0]?.expr).toEqual({
      kind: "cast",
      operand: { kind: "column", name: "win", span: spanOf(text, "win") },
      to: "int",
      form: "function",
      span: spanOf(text, "CAST(win AS INT)"),
    });
  });

  test("<> normalizes to != and % parses", () => {
    const text = "SELECT COUNT(*) AS g FROM t WHERE kills % 2 <> 0";
    const ast = parseClean(text);
    expect(ast.where?.expr).toMatchObject({
      kind: "binary",
      op: "!=",
      left: { kind: "binary", op: "%" },
      right: { kind: "number", value: 0 },
    });
  });

  test("arithmetic precedence and unary minus", () => {
    const precedence = parseClean("SELECT 1 + 2 * 3 AS x FROM t");
    expect(precedence.select?.items[0]?.expr).toMatchObject({
      kind: "binary",
      op: "+",
      left: { kind: "number", value: 1 },
      right: {
        kind: "binary",
        op: "*",
        left: { kind: "number", value: 2 },
        right: { kind: "number", value: 3 },
      },
    });
    const negative = parseClean("SELECT COUNT(*) AS g FROM t WHERE x = -5");
    expect(negative.where?.expr).toMatchObject({
      kind: "binary",
      op: "=",
      right: { kind: "unary", op: "-", operand: { kind: "number", value: 5 } },
    });
  });

  test("boolean and null literals, CURRENT_DATE", () => {
    const ast = parseClean(
      "SELECT COUNT(*) AS g FROM t WHERE win = TRUE AND surrender = false AND ended_at = CURRENT_DATE AND note = NULL",
    );
    expect(ast.where).toBeDefined();
  });

  test("quantile call with fraction argument", () => {
    const text = "SELECT QUANTILE_CONT(damage, 0.9) AS p90 FROM t";
    const ast = parseClean(text);
    expect(ast.select?.items[0]?.expr).toEqual({
      kind: "call",
      name: "quantile_cont",
      star: false,
      distinct: false,
      all: false,
      args: [
        { kind: "column", name: "damage", span: spanOf(text, "damage") },
        { kind: "number", value: 0.9, span: spanOf(text, "0.9") },
      ],
      span: spanOf(text, "QUANTILE_CONT(damage, 0.9)"),
    });
  });

  test("COUNT(DISTINCT x) and group(2)/group(all)", () => {
    const distinct = parseClean("SELECT COUNT(DISTINCT champion) AS c FROM t");
    expect(distinct.select?.items[0]?.expr).toMatchObject({
      kind: "call",
      name: "count",
      distinct: true,
      star: false,
      args: [{ kind: "column", name: "champion" }],
    });
    const groupTwo = parseClean(
      "SELECT COUNT(*) AS g FROM player_groups GROUP BY group(2)",
    );
    expect(groupTwo.groupBy?.items[0]).toMatchObject({
      kind: "call",
      name: "group",
      args: [{ kind: "number", value: 2 }],
      all: false,
    });
    const groupAll = parseClean(
      "SELECT COUNT(*) AS g FROM player_groups GROUP BY group(all)",
    );
    expect(groupAll.groupBy?.items[0]).toMatchObject({
      kind: "call",
      name: "group",
      args: [],
      all: true,
    });
  });
});

describe("statement shapes", () => {
  test("GROUP BY ALL", () => {
    const text = "SELECT player, COUNT(*) AS games FROM t GROUP BY ALL";
    const ast = parseClean(text);
    expect(ast.groupBy).toEqual({
      all: true,
      items: [],
      span: spanOf(text, "GROUP BY ALL"),
    });
  });

  test("grand total — no GROUP BY at all", () => {
    const ast = parseClean("SELECT COUNT(*) AS games FROM match_participants");
    expect(ast.groupBy).toBeUndefined();
    expect(ast.having).toBeUndefined();
    expect(ast.orderBy).toBeUndefined();
    expect(ast.limit).toBeUndefined();
    expect(ast.render).toBeUndefined();
  });

  test("select item without alias", () => {
    const text = "SELECT player FROM t";
    const ast = parseClean(text);
    expect(ast.select?.items[0]).toEqual({
      expr: { kind: "column", name: "player", span: spanOf(text, "player") },
      alias: null,
      aliasSpan: null,
      span: spanOf(text, "player"),
    });
  });

  test("multi-key ORDER BY with default direction", () => {
    const ast = parseClean("SELECT a, b FROM t ORDER BY a DESC, b ASC, a + b");
    expect(ast.orderBy?.keys.map((key) => key.direction)).toEqual([
      "desc",
      "asc",
      null,
    ]);
  });

  test("comments are returned separately and do not disturb spans", () => {
    const text = "-- top\nSELECT COUNT(*) AS g FROM t -- tail";
    const result = parseScoutQl(text);
    expect(result.diagnostics).toEqual([]);
    expect(result.comments.map((token) => token.image)).toEqual([
      "-- top",
      "-- tail",
    ]);
    expect(result.ast.select?.span).toEqual(
      spanOf(text, "SELECT COUNT(*) AS g"),
    );
    expect(result.tokens.every((token) => !token.image.startsWith("--"))).toBe(
      true,
    );
  });
});

describe("RENDER WITH options", () => {
  const text =
    "SELECT COUNT(*) AS games FROM t RENDER bar_chart WITH (" +
    "y = win_rate, colors = (#AABBCC, 'red', 3), " +
    "format = (win_rate = percent, games = 'count'), " +
    "compare = previous_period, stacked = true, mentions = all, title = 'Top', size = 3)";
  function renderOptions() {
    const ast = parseClean(text);
    return {
      ast,
      options: new Map(
        (ast.render?.options ?? []).map((option) => [
          option.name,
          option.value,
        ]),
      ),
    };
  }

  test("kind and option names", () => {
    const { ast, options } = renderOptions();
    expect(ast.render?.kind).toBe("bar_chart");
    expect([...options.keys()]).toEqual([
      "y",
      "colors",
      "format",
      "compare",
      "stacked",
      "mentions",
      "title",
      "size",
    ]);
  });

  test("scalar values", () => {
    const { options } = renderOptions();
    expect(options.get("y")).toMatchObject({
      kind: "identifier",
      name: "win_rate",
    });
    expect(options.get("compare")).toMatchObject({
      kind: "identifier",
      name: "previous_period",
    });
    expect(options.get("stacked")).toMatchObject({
      kind: "boolean",
      value: true,
    });
    expect(options.get("mentions")).toMatchObject({
      kind: "identifier",
      name: "all",
    });
    expect(options.get("title")).toMatchObject({
      kind: "string",
      value: "Top",
    });
    expect(options.get("size")).toMatchObject({ kind: "number", value: 3 });
  });

  test("lists hold colors, strings, and numbers with exact spans", () => {
    const { options } = renderOptions();
    expect(options.get("colors")).toEqual({
      kind: "list",
      items: [
        {
          kind: "hex-color",
          value: "#aabbcc",
          span: spanOf(text, "#AABBCC"),
        },
        { kind: "string", value: "red", span: spanOf(text, "'red'") },
        { kind: "number", value: 3, span: spanOf(text, "3") },
      ],
      span: spanOf(text, "(#AABBCC, 'red', 3)"),
    });
  });

  test("pair lists (format = (alias = kind))", () => {
    const { options } = renderOptions();
    expect(options.get("format")).toMatchObject({
      kind: "list",
      items: [
        {
          kind: "pair",
          name: "win_rate",
          value: { kind: "identifier", name: "percent" },
        },
        {
          kind: "pair",
          name: "games",
          value: { kind: "string", value: "count" },
        },
      ],
    });
  });
});
