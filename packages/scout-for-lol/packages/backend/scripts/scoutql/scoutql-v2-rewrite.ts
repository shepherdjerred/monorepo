import { REPORT_DEFAULT_MAX_ROWS } from "@scout-for-lol/data";
import {
  isLegacySnapshotSource,
  legacyTimeColumn,
  type LegacyAst,
  type LegacyFilter,
  type LegacyFilterValue,
  type LegacyGroupBy,
  type LegacyPlan,
  type LegacySpan,
} from "./scoutql-legacy-bridge.ts";
import { rewriteExpression } from "./scoutql-v2-rewrite-expr.ts";
import { rewriteRenderClause } from "./scoutql-v2-rewrite-render.ts";
import { unconvertible } from "./scoutql-v2-unconvertible.ts";

// ── Route B: legacy query text → ScoutQL v2 query text ───────────────────────
// Splices at the legacy parser's own clause spans, never at string offsets, so
// arbitrary whitespace, newlines, and keyword-lookalikes inside quoted strings
// cannot move an edit. Three composite regions are replaced — the SELECT list,
// FROM…GROUP BY/HAVING (which is where DURING and ANALYZE used to live and now
// do not), and ORDER BY — plus point edits for LIMIT and RENDER. Text outside
// those regions, including the clause keywords between them, is untouched.
//
// Conjuncts inside WHERE are re-emitted in a canonical order rather than in
// source order. Legacy WHERE was AND-only, so reordering is semantically inert,
// and it is what lets the independent IR translator (Route A) reproduce the
// predicate from the legacy PLAN, which does not record conjunct positions.

type Edit = { start: number; end: number; text: string };

function applyEdits(text: string, edits: Edit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let result = text;
  let nextStart = text.length;
  for (const edit of ordered) {
    if (edit.end > nextStart) {
      throw new Error(
        `ScoutQL migration produced overlapping edits at ${edit.start.toString()}.`,
      );
    }
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    nextStart = edit.start;
  }
  return result;
}

// ── Filter values ────────────────────────────────────────────────────────────
// Legacy string comparisons ran `lower(column) = lower(literal)`; v2 is DuckDB
// and compares exactly. A migrated equality therefore has to name the case the
// lake actually stores, which is knowable for every text column except one.

/** Stored lowercase (state.ts QueueTypeSchema values are all lowercase). */
const LOWERCASE_TEXT_COLUMNS = new Set(["queue"]);
/** Stored verbatim from Riot, which is uppercase (TOP, CLASSIC, …). */
const UPPERCASE_TEXT_COLUMNS = new Set([
  "game_mode",
  "game_type",
  "team_position",
  "individual_position",
  "lane",
  "role",
]);
/** Physical lake columns whose legacy filter name differed. */
const FILTER_COLUMNS: Record<string, string> = {
  damage_to_champions: "total_damage_dealt_to_champions",
};

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function textValue(field: string, value: string): string {
  if (LOWERCASE_TEXT_COLUMNS.has(field)) {
    return quoteLiteral(value.toLowerCase());
  }
  if (UPPERCASE_TEXT_COLUMNS.has(field)) {
    return quoteLiteral(value.toUpperCase());
  }
  if (field === "game_version" && !/[a-z]/iu.test(value)) {
    // Patch strings are digits and dots, so folding never changed them.
    return quoteLiteral(value);
  }
  return unconvertible(
    `\`${field} = '${value}'\` matched case-insensitively in the legacy engine and would match exactly in v2, and the lake's casing for ${field} is not knowable from the query. Rewrite this filter by hand.`,
  );
}

function filterValueText(field: string, value: LegacyFilterValue): string {
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return textValue(field, value);
}

function filterText(filter: LegacyFilter): string {
  const column = FILTER_COLUMNS[filter.field] ?? filter.field;
  const values = filter.values.map((value) =>
    filterValueText(filter.field, value),
  );
  if (filter.operator !== "in") {
    const [only] = values;
    if (only === undefined) {
      return unconvertible(`Filter ${filter.field} has no value.`);
    }
    return `${column} ${filter.operator} ${only}`;
  }
  if (filter.values.some((value) => typeof value === "boolean")) {
    // v2's IN list holds numbers and strings only, so a boolean list becomes
    // the OR it always meant.
    return `(${values.map((value) => `${column} = ${value}`).join(" OR ")})`;
  }
  return `${column} IN (${values.join(", ")})`;
}

// ── Clause bodies ────────────────────────────────────────────────────────────

function timeConjunct(plan: LegacyPlan): string | undefined {
  if (isLegacySnapshotSource(plan.source)) {
    // Rank rows are a current snapshot with no timestamp at all; the legacy
    // compiler already forced such a query to ALL TIME and ignored the stated
    // predicate. v2 says the same thing by having no time conjunct.
    return undefined;
  }
  const column = legacyTimeColumn(plan.source);
  const window = plan.window;
  if (window.kind === "all_time") return undefined;
  if (window.kind === "relative") {
    return `${column} >= CURRENT_TIMESTAMP - INTERVAL ${window.days.toString()} DAY`;
  }
  const between = `::DATE BETWEEN '${window.startDate}' AND '${window.endDate}'`;
  return window.timezone === "UTC"
    ? `${column}${between}`
    : `(${column} AT TIME ZONE '${window.timezone}')${between}`;
}

function championConjunct(
  ast: LegacyAst,
  plan: LegacyPlan,
): string | undefined {
  if (plan.championId === undefined) return undefined;
  const named = ast.where.find((clause) => clause.kind === "champion");
  return named === undefined
    ? `champion_id = ${plan.championId.toString()}`
    : `champion_id = champion(${quoteLiteral(named.name)})`;
}

function whereConjuncts(ast: LegacyAst, plan: LegacyPlan): string[] {
  const conjuncts: string[] = [];
  const time = timeConjunct(plan);
  if (time !== undefined) conjuncts.push(time);
  if (plan.competitionId !== undefined) {
    conjuncts.push(`competition_id = ${plan.competitionId.toString()}`);
  }
  if (plan.queueFilter !== undefined && plan.queueFilter.length > 0) {
    const values = plan.queueFilter.map((queue) =>
      quoteLiteral(queue.toLowerCase()),
    );
    conjuncts.push(`queue IN (${values.join(", ")})`);
  }
  const champion = championConjunct(ast, plan);
  if (champion !== undefined) conjuncts.push(champion);
  for (const name of plan.playerRefs) {
    conjuncts.push(`player = player(${quoteLiteral(name)})`);
  }
  for (const filter of plan.filters) {
    conjuncts.push(filterText(filter));
  }
  return conjuncts;
}

function groupingText(dimension: LegacyGroupBy, plan: LegacyPlan): string {
  if (dimension === "group") {
    const size = plan.groupSize;
    if (size === undefined) {
      return unconvertible("GROUP BY group(...) is missing its size.");
    }
    return `group(${size.toString()})`;
  }
  if (dimension !== "day" && dimension !== "week" && dimension !== "month") {
    return dimension;
  }
  const column = legacyTimeColumn(plan.source);
  // A temporal GROUP BY dimension and an ANALYZE bucket cannot coexist (the
  // legacy compiler refused the combination), so any day/week/month dimension
  // in an ANALYZE plan is that plan's bucket and carries its timezone.
  const timezone = plan.analysis?.timezone ?? "UTC";
  const argument =
    timezone === "UTC" ? column : `${column} AT TIME ZONE '${timezone}'`;
  return `DATE_TRUNC('${dimension}', ${argument})`;
}

/**
 * The v2 name of each grouping, in order — what ORDER BY and RENDER cite.
 *
 * Every dimension names itself, including `group`, whose v2 grouping is named
 * `group` at any size. `all` was legacy for a grand total and names nothing.
 */
function groupingNames(plan: LegacyPlan): string[] {
  return plan.groupBys.filter((dimension) => dimension !== "all");
}

function havingText(plan: LegacyPlan): string | undefined {
  const conjuncts: string[] = [];
  if (plan.minGames !== undefined) {
    // Legacy compared the raw per-row game COUNT, so it only reads as `games`
    // when that output is literally the games metric rather than an
    // expression that happens to be named `games`.
    const countsGames = plan.selectItems.some(
      (item) =>
        item.key === "games" &&
        item.expression.kind === "metric" &&
        item.expression.metric === "games",
    );
    const target = countsGames ? "games" : "COUNT(*)";
    conjuncts.push(`${target} >= ${plan.minGames.toString()}`);
  }
  for (const clause of plan.having) {
    conjuncts.push(
      `${clause.key} ${clause.operator} ${clause.value.toString()}`,
    );
  }
  return conjuncts.length === 0 ? undefined : conjuncts.join(" AND ");
}

function orderByText(plan: LegacyPlan): string {
  const direction = plan.orderDirection.toUpperCase();
  if (plan.orderBy !== "label") {
    if (!plan.selectItems.some((item) => item.key === plan.orderBy)) {
      return unconvertible(
        `ORDER BY ${plan.orderBy} sorted by a value this query does not SELECT. v2 orders by an output or a grouping, so add \`${plan.orderBy}\` to SELECT or choose another key.`,
      );
    }
    return `${plan.orderBy} ${direction}`;
  }
  const names = groupingNames(plan);
  const [only] = names;
  if (only === undefined || names.length !== 1) {
    return unconvertible(
      "ORDER BY sorted by the combined grouping label, which v2 replaces with one key per grouping. Choose which grouping to sort by.",
    );
  }
  return `${only} ${direction}`;
}

function selectText(plan: LegacyPlan): string {
  return plan.selectItems
    .map((item) => `${rewriteExpression(item.expression)} AS ${item.key}`)
    .join(", ");
}

// ── Region assembly ──────────────────────────────────────────────────────────

function sourceThroughGroupByText(ast: LegacyAst, plan: LegacyPlan): string {
  const parts: string[] = [plan.source];
  const conjuncts = whereConjuncts(ast, plan);
  if (conjuncts.length > 0) {
    parts.push(`WHERE ${conjuncts.join(" AND ")}`);
  }
  const groupings = plan.groupBys
    .filter((dimension) => dimension !== "all")
    .map((dimension) => groupingText(dimension, plan));
  if (groupings.length > 0) {
    parts.push(`GROUP BY ${groupings.join(", ")}`);
  }
  const having = havingText(plan);
  if (having !== undefined) {
    parts.push(`HAVING ${having}`);
  }
  return parts.join(" ");
}

function tailEnd(ast: LegacyAst, groupBySpan: LegacySpan): number {
  const ends = [groupBySpan.end];
  for (const item of [ast.having, ast.during, ast.analysis]) {
    if (item !== undefined) ends.push(item.span.end);
  }
  return Math.max(...ends);
}

function renderEdit(ast: LegacyAst, plan: LegacyPlan): Edit | undefined {
  const comparison = plan.analysis?.comparison;
  if (comparison?.kind === "calendar") {
    return unconvertible(
      "COMPARE TO BETWEEN '…' AND '…' has no v2 equivalent — v2 ships previous_period only. Rewrite this report by hand.",
    );
  }
  const addCompare = comparison?.kind === "previous_period";
  if (ast.render === undefined) {
    if (!addCompare) return undefined;
    return unconvertible(
      "COMPARE TO PREVIOUS PERIOD became the chart option `compare = previous_period`, and this report has no RENDER clause to carry it.",
    );
  }
  const names = groupingNames(plan);
  const clause = rewriteRenderClause({
    clause: ast.render.value,
    groupingName: names.length === 1 ? names[0] : undefined,
    isChart: "encoding" in plan.render,
    addCompare,
  });
  return {
    start: ast.render.span.start,
    end: ast.render.span.end,
    text: `RENDER ${clause}`,
  };
}

/** Rewrite one stored legacy query into its ScoutQL v2 spelling. */
export function rewriteLegacyQueryText(
  text: string,
  ast: LegacyAst,
  plan: LegacyPlan,
): string {
  const source = ast.source;
  const groupBy = ast.groupBy;
  const firstSelect = ast.select[0];
  const lastSelect = ast.select.at(-1);
  if (
    source === undefined ||
    groupBy === undefined ||
    firstSelect === undefined ||
    lastSelect === undefined
  ) {
    // Unreachable: the legacy compiler refuses every one of these shapes, and
    // this only runs on a plan it produced.
    return unconvertible("Query is missing SELECT, FROM, or GROUP BY.");
  }

  const edits: Edit[] = [
    {
      start: firstSelect.span.start,
      end: lastSelect.span.end,
      text: selectText(plan),
    },
  ];

  const order = orderByText(plan);
  const explicitLimit =
    ast.limit === undefined && plan.limit !== REPORT_DEFAULT_MAX_ROWS
      ? ` LIMIT ${plan.limit.toString()}`
      : "";
  const orderSpan = ast.orderBy;
  const body = sourceThroughGroupByText(ast, plan);
  edits.push({
    start: source.span.start,
    end: tailEnd(ast, groupBy.span),
    text:
      orderSpan === undefined
        ? `${body} ORDER BY ${order}${explicitLimit}`
        : body,
  });
  if (orderSpan !== undefined) {
    const end = (orderSpan.direction ?? orderSpan.metric).span.end;
    edits.push({
      start: orderSpan.metric.span.start,
      end,
      text: `${order}${explicitLimit}`,
    });
  }

  const render = renderEdit(ast, plan);
  if (render !== undefined) edits.push(render);
  return applyEdits(text, edits);
}
