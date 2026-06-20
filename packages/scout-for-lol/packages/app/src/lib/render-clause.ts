/**
 * Light helpers for reading and rewriting the trailing `RENDER` clause of a
 * report query from the web form's Display builder. The textarea remains the
 * single source of truth (and stays hand-editable); these helpers let the
 * builder dropdowns read/replace the clause without re-implementing the backend
 * parser (`packages/backend/src/reports/query-language.ts`).
 *
 * Clause location mirrors the backend: the RENDER clause is structurally the
 * *tail* of the query, always after `GROUP BY`. We therefore anchor on the
 * first ` render ` token that appears **after** `group by` — never on a bare
 * "render" substring elsewhere (e.g. inside a `WHERE name LIKE '%render%'`
 * literal, which sits before GROUP BY and must be left untouched).
 */

const RENDER_KIND_TOKENS = [
  "bar_chart",
  "line_chart",
  "table",
  "list",
  "leaderboard",
] as const;

/**
 * Index (into the original text) of the space that begins the trailing
 * ` RENDER ` clause, or -1 when the query has no clause. Returns -1 if `render`
 * only appears before `GROUP BY` (i.e. inside the query body, not as a clause).
 */
function renderClauseIndex(queryText: string): number {
  const lower = queryText.toLowerCase();
  const groupByIndex = lower.indexOf(" group by ");
  // Without a GROUP BY there is no well-formed clause tail to anchor on; treat
  // any "render" as body text and report "no clause".
  const searchFrom =
    groupByIndex === -1 ? -1 : groupByIndex + " group by ".length;
  if (searchFrom === -1) return -1;
  return lower.indexOf(" render ", searchFrom);
}

export function renderKindFromQuery(queryText: string): string {
  const index = renderClauseIndex(queryText);
  if (index === -1) return "TABLE";
  const after = queryText
    .slice(index + " render ".length)
    .trimStart()
    .toLowerCase();
  const token = RENDER_KIND_TOKENS.find(
    (kind) => after === kind || after.startsWith(`${kind} `),
  );
  return token === undefined ? "TABLE" : token.toUpperCase();
}

const RENDER_Y = /\bwith\s*\([^)]*\by\s*=\s*['"]?(\w+)['"]?/i;

export function renderYFromQuery(queryText: string): string {
  const index = renderClauseIndex(queryText);
  if (index === -1) return "";
  const clause = queryText.slice(index + " render ".length);
  return RENDER_Y.exec(clause)?.[1] ?? "";
}

export function isChartKind(kind: string): boolean {
  return kind === "BAR_CHART" || kind === "LINE_CHART";
}

export function buildRenderClause(kind: string, yMetric: string): string {
  const token = kind.toLowerCase();
  if (isChartKind(kind) && yMetric.length > 0) {
    return `RENDER ${token} WITH (y = ${yMetric})`;
  }
  return `RENDER ${token}`;
}

/**
 * Replace the query's existing RENDER clause (if any) with `clause`, or append
 * it when none exists. Only the structurally-anchored clause is replaced — a
 * literal "render" earlier in the query is preserved.
 */
export function upsertRenderClause(queryText: string, clause: string): string {
  const index = renderClauseIndex(queryText);
  const base =
    index === -1 ? queryText.trimEnd() : queryText.slice(0, index).trimEnd();
  return base.length === 0 ? clause : `${base} ${clause}`;
}
