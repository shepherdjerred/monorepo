import type { ScoutQlQueryAst } from "@scout-for-lol/data/model/scoutql/ast.ts";
import { parseScoutQl } from "@scout-for-lol/data/model/scoutql/parse.ts";

// ── The clause-order summary ─────────────────────────────────────────────────
// The in-app reference used to carry a hand-typed grammar string, and it had
// already drifted: it still described clauses the language no longer has. So
// neither half of this summary is written down twice.
//
//   * WHICH clauses exist is `keyof ScoutQlQueryAst` — a clause the grammar
//     gains fails to typecheck here until someone writes its entry, and the
//     count check below catches one that was added to the AST but not listed.
//   * WHAT ORDER they go in is read from a real parse of the exemplar below,
//     by the offset each clause actually started at, so the grammar answers
//     for itself rather than a hand-kept list staying in step.

/** Every clause of a query, as the AST names them. */
export type ScoutQlClauseName = Exclude<keyof ScoutQlQueryAst, "span">;

type ClauseDetail = {
  keyword: string;
  syntax: string;
  required: boolean;
  description: string;
};

export type ScoutQlClauseDoc = ClauseDetail & { clause: ScoutQlClauseName };

/**
 * A query that uses every clause exactly once. It doubles as the reference's
 * "shape of a query" example, so the text a reader copies is the same text the
 * ordering was derived from.
 */
export const SCOUTQL_SHAPE_EXAMPLE = `SELECT DATE_TRUNC('week', game_creation_at) AS week, COUNT(*) AS games
FROM match_participants
WHERE game_creation_at >= CURRENT_TIMESTAMP - INTERVAL 90 DAY
GROUP BY DATE_TRUNC('week', game_creation_at)
HAVING games >= 5
ORDER BY week ASC
LIMIT 20
RENDER line_chart WITH (y = games, smooth = true)`;

const CLAUSE_NAMES = [
  "select",
  "from",
  "where",
  "groupBy",
  "having",
  "orderBy",
  "limit",
  "render",
] as const satisfies readonly ScoutQlClauseName[];

const CLAUSE_DETAIL: Record<ScoutQlClauseName, ClauseDetail> = {
  select: {
    keyword: "SELECT",
    syntax: "SELECT <expression> [AS <name>], …",
    required: true,
    description:
      "One to twenty outputs. Aggregation is always explicit — COUNT(*), AVG(win::INT), SUM(gold_earned) — and every computed output needs an AS name so later clauses can refer to it.",
  },
  from: {
    keyword: "FROM",
    syntax: "FROM <source>",
    required: true,
    description: "Exactly one source, from the list below.",
  },
  where: {
    keyword: "WHERE",
    syntax: "WHERE <condition> [AND | OR <condition>] …",
    required: false,
    description:
      "Filters raw rows before they are aggregated. Full boolean logic with NOT and parentheses, plus IN, BETWEEN, LIKE, ILIKE and IS NULL. Aggregates belong in HAVING, not here.",
  },
  groupBy: {
    keyword: "GROUP BY",
    syntax: "GROUP BY <expression>[, …] | GROUP BY ALL",
    required: false,
    description:
      "Up to three dimensions: a column, an expression such as DATE_TRUNC('week', game_creation_at), or group(2…5|all) on player_groups. ALL groups by every non-aggregate output; omitting it entirely returns one grand-total row.",
  },
  having: {
    keyword: "HAVING",
    syntax: "HAVING <condition>",
    required: false,
    description:
      "Filters grouped rows, and may name aggregates or SELECT aliases — HAVING games >= 10 is the usual sample-size floor.",
  },
  orderBy: {
    keyword: "ORDER BY",
    syntax: "ORDER BY <output | expression> [ASC | DESC][, …]",
    required: false,
    description:
      "Up to three keys. Ties break on the row label, so the same data always comes back in the same order.",
  },
  limit: {
    keyword: "LIMIT",
    syntax: "LIMIT <n>",
    required: false,
    description: "How many rows to return. Defaults to 10.",
  },
  render: {
    keyword: "RENDER",
    syntax: "RENDER <kind> [WITH (<option> = <value>, …)]",
    required: false,
    description:
      "Chooses the display and its encodings. Omitting it renders a table.",
  },
};

function clauseStart(ast: ScoutQlQueryAst, clause: ScoutQlClauseName): number {
  const node = ast[clause];
  if (node === undefined) {
    // The exemplar is meant to use every clause; one missing from the parse
    // means the exemplar or the grammar moved and the summary is incomplete.
    throw new Error(
      `The ScoutQL shape example does not use its ${clause} clause.`,
    );
  }
  return node.span.start;
}

/** Every clause of a ScoutQL query, in the order the grammar accepts them. */
export function scoutQlClauseSummary(): ScoutQlClauseDoc[] {
  if (CLAUSE_NAMES.length !== Object.keys(CLAUSE_DETAIL).length) {
    throw new Error(
      "ScoutQL gained a clause that the reference does not list yet.",
    );
  }
  const { ast } = parseScoutQl(SCOUTQL_SHAPE_EXAMPLE);
  return CLAUSE_NAMES.map((clause) => ({
    ...CLAUSE_DETAIL[clause],
    clause,
  })).toSorted(
    (left, right) =>
      clauseStart(ast, left.clause) - clauseStart(ast, right.clause),
  );
}
