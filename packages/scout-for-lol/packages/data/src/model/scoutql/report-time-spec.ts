import { match } from "ts-pattern";
import type {
  ScoutQlExprAst,
  ScoutQlQueryAst,
} from "#src/model/scoutql/ast.ts";
import { flattenAnd } from "#src/model/scoutql/ast.ts";
import {
  analyzeScoutQl,
  type ScoutQlAnalysis,
} from "#src/model/scoutql/analyze.ts";
import {
  recognizeCalendarWindow,
  recognizeRelativeWindow,
} from "#src/model/scoutql/analyze-window.ts";
import { tokenizeScoutQl } from "#src/model/scoutql/tokens.ts";
import {
  applyBucketEdit,
  readBucket,
  type ReportTimeBucket,
} from "#src/model/scoutql/report-time-spec-bucket.ts";
import {
  applyScoutQlEdits,
  clauseSeparator,
  listItemDeletion,
  withLeadingWhitespace,
  type ScoutQlEdit,
} from "#src/model/scoutql/report-time-spec-edit.ts";

// ── The report's time controls, as text ──────────────────────────────────────
// The app's period / bucket / compare controls edit the QUERY, because the
// query is the report — there is no second representation to keep in sync.
// Reading answers "what do the controls show?", applying answers "what text
// says that instead?", and every clause the controls do not own survives byte
// for byte.
//
// The two properties that make the controls safe to wire to a live editor:
//
//   * `applyReportTimeSpec(text, readReportTimeSpec(text))` is the identity —
//     each facet compares against the current text and no-ops when equal, so
//     merely opening the controls never rewrites anything.
//   * Facets are applied one at a time, each re-reading the text the previous
//     one produced, so a bucket edit can never collide with a window edit.

export type ReportTimeWindow =
  | { kind: "relative"; days: number }
  | { kind: "calendar"; start: string; end: string; timezone: string }
  | { kind: "all-history" };

export type ReportTimeSpec = {
  window: ReportTimeWindow;
  bucket: ReportTimeBucket | null;
  compare: boolean;
  /** Zone for calendar bounds and bucket boundaries; "UTC" when unstated. */
  timezone: string;
};

const UNIT_DAYS: Record<"day" | "week" | "month" | "year", number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
};

const COMPARE_OPTION = "compare = previous_period";

// ── Reading ──────────────────────────────────────────────────────────────────

function readWindow(analysis: ScoutQlAnalysis): ReportTimeWindow | undefined {
  const window = analysis.timeWindow;
  // `bounded` is a hand-written time filter the controls did not create and
  // must not clobber; `snapshot` sources have no history to bound at all.
  if (window.kind === "bounded" || window.kind === "snapshot") {
    return undefined;
  }
  return match(window)
    .with({ kind: "relative" }, (relative): ReportTimeWindow => ({
      kind: "relative",
      days: relative.amount * UNIT_DAYS[relative.unit],
    }))
    .with({ kind: "calendar" }, (calendar): ReportTimeWindow => ({
      kind: "calendar",
      start: calendar.startDate,
      end: calendar.endDate,
      timezone: calendar.timezone,
    }))
    .with({ kind: "unbounded" }, (): ReportTimeWindow => ({
      kind: "all-history",
    }))
    .exhaustive();
}

function readCompare(ast: ScoutQlQueryAst): boolean {
  return (ast.render?.options ?? []).some(
    (option) =>
      option.name === "compare" &&
      option.value.kind === "identifier" &&
      option.value.name === "previous_period",
  );
}

/**
 * What the time controls should display for a query, or undefined when they
 * do not apply: the query has an error, its source has no time column, or its
 * time filter is a hand-written shape a control cannot represent.
 */
export function readReportTimeSpec(text: string): ReportTimeSpec | undefined {
  const analysis = analyzeScoutQl(text);
  if (
    analysis.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  ) {
    return undefined;
  }
  const window = readWindow(analysis);
  if (window === undefined) {
    return undefined;
  }
  const bucket = readBucket(analysis);
  return {
    window,
    bucket: bucket.bucket,
    compare: readCompare(analysis.parse.ast),
    timezone: window.kind === "calendar" ? window.timezone : bucket.timezone,
  };
}

// ── The window facet ─────────────────────────────────────────────────────────

function windowPredicate(
  window: ReportTimeWindow,
  timeColumn: string,
): string | undefined {
  // All history is the ABSENCE of a predicate, which is why it deletes rather
  // than rewrites the conjunct.
  if (window.kind === "all-history") {
    return undefined;
  }
  return match(window)
    .with(
      { kind: "relative" },
      (relative) =>
        `${timeColumn} >= CURRENT_TIMESTAMP - INTERVAL ${String(relative.days)} DAY`,
    )
    .with({ kind: "calendar" }, (calendar) => {
      const operand =
        calendar.timezone === "UTC"
          ? timeColumn
          : `(${timeColumn} AT TIME ZONE '${calendar.timezone}')`;
      return `${operand}::DATE BETWEEN '${calendar.start}' AND '${calendar.end}'`;
    })
    .exhaustive();
}

/** The conjunct `analyzeWhere` hoisted, so an edit replaces exactly it. */
function recognizedConjunctIndex(
  conjuncts: ScoutQlExprAst[],
  timeColumn: string,
): number {
  return conjuncts.findIndex((conjunct) => {
    if (recognizeRelativeWindow(conjunct, timeColumn) !== undefined) {
      return true;
    }
    return recognizeCalendarWindow(conjunct, timeColumn, [])?.kind === "window";
  });
}

function insertPredicateEdit(
  text: string,
  ast: ScoutQlQueryAst,
  predicate: string,
): ScoutQlEdit | undefined {
  const where = ast.where;
  if (where === undefined) {
    const anchor = ast.from?.span.end;
    if (anchor === undefined) {
      return undefined;
    }
    return {
      start: anchor,
      end: anchor,
      newText: `${clauseSeparator(text, anchor)}WHERE ${predicate}`,
    };
  }
  // A WHERE already broken across lines gains its new conjunct as a line.
  const separator = text.slice(where.span.start, where.span.end).includes("\n")
    ? "\n  AND "
    : " AND ";
  // Appending `AND …` to a top-level OR would bind to its right operand only
  // and quietly change the question, so the existing predicate is wrapped.
  if (where.expr.kind === "binary" && where.expr.op === "or") {
    const span = where.expr.span;
    return {
      start: span.start,
      end: span.end,
      newText: `(${text.slice(span.start, span.end)}) AND ${predicate}`,
    };
  }
  return {
    start: where.expr.span.end,
    end: where.expr.span.end,
    newText: `${separator}${predicate}`,
  };
}

function removePredicateEdits(
  text: string,
  ast: ScoutQlQueryAst,
  conjuncts: ScoutQlExprAst[],
  index: number,
): ScoutQlEdit[] {
  const where = ast.where;
  if (where === undefined) {
    return [];
  }
  const deletion = listItemDeletion(
    conjuncts.map((conjunct) => conjunct.span),
    index,
  );
  return [
    deletion ??
      withLeadingWhitespace(text, {
        start: where.span.start,
        end: where.span.end,
        newText: "",
      }),
  ];
}

function applyWindowEdit(
  text: string,
  analysis: ScoutQlAnalysis,
  window: ReportTimeWindow,
): string {
  const timeColumn = analysis.source?.timeColumn;
  if (timeColumn === undefined || timeColumn === null) {
    return text;
  }
  const { ast } = analysis.parse;
  const conjuncts = ast.where === undefined ? [] : flattenAnd(ast.where.expr);
  const index = recognizedConjunctIndex(conjuncts, timeColumn);
  const predicate = windowPredicate(window, timeColumn);
  if (predicate === undefined) {
    return index === -1
      ? text
      : applyScoutQlEdits(
          text,
          removePredicateEdits(text, ast, conjuncts, index),
        );
  }
  const existing = conjuncts[index];
  if (existing === undefined) {
    const edit = insertPredicateEdit(text, ast, predicate);
    return edit === undefined ? text : applyScoutQlEdits(text, [edit]);
  }
  if (text.slice(existing.span.start, existing.span.end) === predicate) {
    return text;
  }
  return applyScoutQlEdits(text, [
    { start: existing.span.start, end: existing.span.end, newText: predicate },
  ]);
}

// ── The compare facet ────────────────────────────────────────────────────────

/** Offset of the `WITH` token inside the RENDER clause, when it has one. */
function withTokenStart(
  text: string,
  span: { start: number; end: number },
): number | undefined {
  const token = tokenizeScoutQl(text).tokens.find(
    (candidate) =>
      candidate.tokenType.name === "With" &&
      candidate.startOffset >= span.start &&
      candidate.startOffset < span.end,
  );
  return token?.startOffset;
}

function lastClauseEnd(ast: ScoutQlQueryAst): number {
  return Math.max(
    ast.select?.span.end ?? 0,
    ast.from?.span.end ?? 0,
    ast.where?.span.end ?? 0,
    ast.groupBy?.span.end ?? 0,
    ast.having?.span.end ?? 0,
    ast.orderBy?.span.end ?? 0,
    ast.limit?.span.end ?? 0,
  );
}

function enableCompareEdit(
  text: string,
  ast: ScoutQlQueryAst,
): ScoutQlEdit | undefined {
  const render = ast.render;
  if (render === undefined) {
    // A comparison overlays two series, which only a chart can show; the query
    // gains the smallest render clause that can carry it.
    const anchor = lastClauseEnd(ast);
    return anchor === 0
      ? undefined
      : {
          start: anchor,
          end: anchor,
          newText: ` RENDER line_chart WITH (${COMPARE_OPTION})`,
        };
  }
  const closing = render.span.end - 1;
  if (text[closing] === ")") {
    return {
      start: closing,
      end: closing,
      newText:
        render.options.length === 0 ? COMPARE_OPTION : `, ${COMPARE_OPTION}`,
    };
  }
  return {
    start: render.span.end,
    end: render.span.end,
    newText: ` WITH (${COMPARE_OPTION})`,
  };
}

function disableCompareEdit(
  text: string,
  ast: ScoutQlQueryAst,
): ScoutQlEdit | undefined {
  const render = ast.render;
  if (render === undefined) {
    return undefined;
  }
  const index = render.options.findIndex((option) => option.name === "compare");
  if (index === -1) {
    return undefined;
  }
  const deletion = listItemDeletion(
    render.options.map((option) => option.span),
    index,
  );
  if (deletion !== undefined) {
    return deletion;
  }
  const start = withTokenStart(text, render.span);
  return start === undefined
    ? undefined
    : withLeadingWhitespace(text, {
        start,
        end: render.span.end,
        newText: "",
      });
}

function applyCompareEdit(
  text: string,
  analysis: ScoutQlAnalysis,
  compare: boolean,
): string {
  const { ast } = analysis.parse;
  if (readCompare(ast) === compare) {
    return text;
  }
  const edit = compare
    ? enableCompareEdit(text, ast)
    : disableCompareEdit(text, ast);
  return edit === undefined ? text : applyScoutQlEdits(text, [edit]);
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Rewrite a query so its time controls read as `spec`.
 *
 * Facets that cannot be expressed are left alone rather than approximated: a
 * hand-written time filter, a source with no time column, or a bucket that is
 * the query's only output. Returns the input unchanged for a query the
 * controls do not apply to at all.
 */
export function applyReportTimeSpec(
  text: string,
  spec: ReportTimeSpec,
): string {
  if (readReportTimeSpec(text) === undefined) {
    return text;
  }
  const afterWindow = applyWindowEdit(text, analyzeScoutQl(text), spec.window);
  const afterBucket = applyBucketEdit(
    afterWindow,
    analyzeScoutQl(afterWindow),
    { bucket: spec.bucket, timezone: spec.timezone },
  );
  return applyCompareEdit(
    afterBucket,
    analyzeScoutQl(afterBucket),
    spec.compare,
  );
}
