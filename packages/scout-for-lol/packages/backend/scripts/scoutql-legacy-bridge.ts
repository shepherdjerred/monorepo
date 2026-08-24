import { compileReportQuery, parseReportQuery } from "@scout-for-lol/data";
import type {
  ReportParseResult,
  ReportQueryAst,
  ReportQueryPlan,
} from "@scout-for-lol/data";

// ── The one legacy import site ───────────────────────────────────────────────
// Every other module in the ScoutQL v2 migration reaches the legacy language
// through this file. The legacy lexer/parser/compiler are scheduled to move to
// `data/src/model/legacy/` (importable only by this migration and its tests)
// and to be deleted one release after production logs a zero-rewrite boot, so
// the relocation has to be a one-file edit rather than a sweep.
//
// Nothing here re-exports: the repo's `no-re-exports` rule forbids it, and the
// wrapper functions are what make the seam real — a direct re-export would let
// a caller reach the legacy module's whole surface again. Legacy types are
// derived from the wrappers' inferred results for the same reason.

/** Lenient legacy parse: AST with source spans plus structural diagnostics. */
export function parseLegacyQuery(text: string): ReportParseResult {
  return parseReportQuery(text);
}

/** Strict legacy compile of an already-parsed AST. Throws on any violation. */
export function compileLegacyAst(ast: ReportQueryAst): ReportQueryPlan {
  return compileReportQuery(ast);
}

type LegacyParseResult = ReturnType<typeof parseLegacyQuery>;
export type LegacyAst = LegacyParseResult["ast"];
type LegacyItem = NonNullable<LegacyAst["groupBy"]>;
export type LegacySpan = LegacyItem["span"];

export type LegacyPlan = ReturnType<typeof compileLegacyAst>;
type LegacySource = LegacyPlan["source"];
export type LegacyGroupBy = LegacyPlan["groupBys"][number];
export type LegacyMetric = LegacyPlan["metrics"][number];
type LegacySelectItem = LegacyPlan["selectItems"][number];
export type LegacyExpression = LegacySelectItem["expression"];
export type LegacyFilter = LegacyPlan["filters"][number];
export type LegacyFilterValue = LegacyFilter["values"][number];

/** Sources whose rows are a snapshot: no time column, no time window. */
const SNAPSHOT_SOURCES = new Set<string>(["rank_current", "competition_rank"]);

export function isLegacySnapshotSource(source: LegacySource): boolean {
  return SNAPSHOT_SOURCES.has(source);
}

/** The timestamp column a source's time window is expressed over. */
export function legacyTimeColumn(source: LegacySource): string {
  return source === "prematch_participants"
    ? "observed_at"
    : "game_creation_at";
}
