import type {
  ScoutQlExprAst,
  ScoutQlQueryAst,
} from "#src/model/scoutql/ast.ts";
import { sameExpr } from "#src/model/scoutql/ast.ts";
import type { ScoutQlSpan } from "#src/model/scoutql/diagnostics.ts";
import type { ScoutQlAnalysis } from "#src/model/scoutql/analyze.ts";
import { forEachExprNode } from "#src/model/scoutql/analyze-expr-shared.ts";
import type { AnalyzedGrouping } from "#src/model/scoutql/analyze-group.ts";
import {
  applyScoutQlEdits,
  clauseSeparator,
  listItemDeletion,
  withLeadingWhitespace,
  type ScoutQlEdit,
} from "#src/model/scoutql/report-time-spec-edit.ts";

// ── The bucket facet of the time controls ────────────────────────────────────
// "Group by day / week / month / patch / none" is a rewrite of one grouping
// term wherever it appears — GROUP BY, its SELECT echo, and any ORDER BY key
// naming it. It is the fiddliest facet because the bucket is not one place in
// the text: changing only the GROUP BY term would leave the SELECT echo
// unmatched, which is an error rather than a different question.

export type ReportTimeBucket = "day" | "week" | "month" | "patch";

export type ReadBucket = {
  bucket: ReportTimeBucket | null;
  /** The zone the bucket boundaries fall in; "UTC" unless stated. */
  timezone: string;
  grouping: AnalyzedGrouping | undefined;
};

export function readBucket(analysis: ScoutQlAnalysis): ReadBucket {
  for (const grouping of analysis.groupings) {
    const shape = grouping.grouping;
    if (shape.kind === "date-trunc") {
      return {
        bucket: shape.part,
        timezone: shape.timezone,
        grouping,
      };
    }
    if (shape.kind === "column" && shape.column === "patch") {
      return { bucket: "patch", timezone: "UTC", grouping };
    }
  }
  return { bucket: null, timezone: "UTC", grouping: undefined };
}

function bucketTerm(
  bucket: ReportTimeBucket,
  timeColumn: string,
  timezone: string,
): string {
  if (bucket === "patch") {
    return "patch";
  }
  const operand =
    timezone === "UTC"
      ? timeColumn
      : `${timeColumn} AT TIME ZONE '${timezone}'`;
  return `DATE_TRUNC('${bucket}', ${operand})`;
}

function matchingIndexes(
  items: readonly { expr: ScoutQlExprAst }[],
  reference: ScoutQlExprAst,
): number[] {
  return items.flatMap((item, index) =>
    sameExpr(item.expr, reference) ? [index] : [],
  );
}

function columnRefSpans(
  expr: ScoutQlExprAst | undefined,
  name: string,
): ScoutQlSpan[] {
  if (expr === undefined) {
    return [];
  }
  const spans: ScoutQlSpan[] = [];
  forEachExprNode(expr, (node) => {
    if (node.kind === "column" && node.name === name) {
      spans.push(node.span);
    }
  });
  return spans;
}

// ── Renaming the bucket's name ───────────────────────────────────────────────

/**
 * References to the bucket's name outside its own term: ORDER BY and HAVING
 * mentions, plus RENDER channel encodings. Renamed only when the author used
 * the derived name (`… AS week`) — a hand-chosen alias is theirs to keep.
 */
function renameEdits(
  ast: ScoutQlQueryAst,
  oldName: string,
  newName: string,
): ScoutQlEdit[] {
  const spans: ScoutQlSpan[] = [
    ...(ast.orderBy?.keys ?? []).flatMap((key) =>
      columnRefSpans(key.expr, oldName),
    ),
    ...columnRefSpans(ast.having?.expr, oldName),
  ];
  for (const option of ast.render?.options ?? []) {
    const value = option.value;
    if (value.kind === "identifier" && value.name === oldName) {
      spans.push(value.span);
      continue;
    }
    if (value.kind !== "list") {
      continue;
    }
    for (const item of value.items) {
      if (item.kind === "identifier" && item.name === oldName) {
        spans.push(item.span);
      }
    }
  }
  return spans.map((span) => ({
    start: span.start,
    end: span.end,
    newText: newName,
  }));
}

// ── Replace / insert / remove ────────────────────────────────────────────────

type ReplaceInput = {
  ast: ScoutQlQueryAst;
  grouping: AnalyzedGrouping;
  current: ReportTimeBucket;
  target: ReportTimeBucket;
  timeColumn: string;
  timezone: string;
};

function selectItemText(
  term: string,
  name: string,
  target: ReportTimeBucket,
): string {
  // `patch AS patch` is noise; the bare column already carries the name.
  return target === "patch" && name === "patch" ? term : `${term} AS ${name}`;
}

function replaceEdits(input: ReplaceInput): ScoutQlEdit[] {
  const { ast, grouping } = input;
  const oldName = grouping.grouping.name;
  const newDefault = input.target;
  const rename = oldName === input.current && newDefault !== oldName;
  const name = rename ? newDefault : oldName;
  const term = bucketTerm(input.target, input.timeColumn, input.timezone);
  const edits = new Map<number, ScoutQlEdit>();
  if (rename) {
    for (const edit of renameEdits(ast, oldName, name)) {
      edits.set(edit.start, edit);
    }
  }
  for (const index of matchingIndexes(ast.select?.items ?? [], grouping.ast)) {
    const item = ast.select?.items[index];
    if (item !== undefined && !edits.has(item.span.start)) {
      edits.set(item.span.start, {
        start: item.span.start,
        end: item.span.end,
        newText: selectItemText(term, name, input.target),
      });
    }
  }
  const termTargets: ScoutQlExprAst[] = [
    ...(ast.groupBy?.items ?? []),
    ...(ast.orderBy?.keys ?? []).map((key) => key.expr),
  ];
  for (const expr of termTargets) {
    if (sameExpr(expr, grouping.ast) && !edits.has(expr.span.start)) {
      edits.set(expr.span.start, {
        start: expr.span.start,
        end: expr.span.end,
        newText: term,
      });
    }
  }
  return [...edits.values()];
}

function removeEdits(
  text: string,
  ast: ScoutQlQueryAst,
  grouping: AnalyzedGrouping,
): ScoutQlEdit[] | undefined {
  const edits: ScoutQlEdit[] = [];
  const selectItems = ast.select?.items ?? [];
  for (const index of matchingIndexes(selectItems, grouping.ast)) {
    const deletion = listItemDeletion(
      selectItems.map((item) => item.span),
      index,
    );
    if (deletion === undefined) {
      // The bucket is the query's only output; removing it would leave an
      // empty SELECT, so the control cannot express this change.
      return undefined;
    }
    edits.push(deletion);
  }
  const groupBy = ast.groupBy;
  if (groupBy !== undefined && !groupBy.all) {
    const indexes = groupBy.items.flatMap((item, index) =>
      sameExpr(item, grouping.ast) ? [index] : [],
    );
    for (const index of indexes) {
      const deletion = listItemDeletion(
        groupBy.items.map((item) => item.span),
        index,
      );
      edits.push(
        deletion ??
          withLeadingWhitespace(text, {
            start: groupBy.span.start,
            end: groupBy.span.end,
            newText: "",
          }),
      );
    }
  }
  const orderBy = ast.orderBy;
  if (orderBy !== undefined) {
    const name = grouping.grouping.name;
    const indexes = orderBy.keys.flatMap((key, index) => {
      const references =
        sameExpr(key.expr, grouping.ast) ||
        (key.expr.kind === "column" && key.expr.name === name);
      return references ? [index] : [];
    });
    for (const index of indexes) {
      const deletion = listItemDeletion(
        orderBy.keys.map((key) => key.span),
        index,
      );
      edits.push(
        deletion ??
          withLeadingWhitespace(text, {
            start: orderBy.span.start,
            end: orderBy.span.end,
            newText: "",
          }),
      );
    }
  }
  return edits;
}

type InsertInput = {
  text: string;
  ast: ScoutQlQueryAst;
  target: ReportTimeBucket;
  timeColumn: string;
  timezone: string;
};

function insertEdits(input: InsertInput): ScoutQlEdit[] {
  const { ast, target } = input;
  const term = bucketTerm(target, input.timeColumn, input.timezone);
  const edits: ScoutQlEdit[] = [];
  const firstSelect = ast.select?.items[0];
  if (firstSelect === undefined) {
    return [];
  }
  edits.push({
    start: firstSelect.span.start,
    end: firstSelect.span.start,
    newText: `${selectItemText(term, target, target)}, `,
  });
  const groupBy = ast.groupBy;
  if (groupBy === undefined) {
    const anchor = ast.where?.span.end ?? ast.from?.span.end;
    if (anchor !== undefined) {
      edits.push({
        start: anchor,
        end: anchor,
        newText: `${clauseSeparator(input.text, anchor)}GROUP BY ${term}`,
      });
    }
    return edits;
  }
  // `GROUP BY ALL` already takes every non-aggregate output, so the SELECT
  // insertion is the whole change.
  const firstGroup = groupBy.items[0];
  if (firstGroup !== undefined && !groupBy.all) {
    edits.push({
      start: firstGroup.span.start,
      end: firstGroup.span.start,
      newText: `${term}, `,
    });
  }
  return edits;
}

/**
 * Rewrite the query's time bucket, leaving every other clause byte-for-byte
 * intact. Returns the input unchanged when the bucket already matches, or when
 * the change is not expressible (no time column, or the bucket is the query's
 * only output).
 */
export function applyBucketEdit(
  text: string,
  analysis: ScoutQlAnalysis,
  target: { bucket: ReportTimeBucket | null; timezone: string },
): string {
  const timeColumn = analysis.source?.timeColumn;
  if (timeColumn === undefined || timeColumn === null) {
    return text;
  }
  const current = readBucket(analysis);
  const zoneMatters = target.bucket !== null && target.bucket !== "patch";
  if (
    current.bucket === target.bucket &&
    (!zoneMatters || current.timezone === target.timezone)
  ) {
    return text;
  }
  const { ast } = analysis.parse;
  if (target.bucket === null) {
    const grouping = current.grouping;
    if (grouping === undefined) {
      return text;
    }
    const edits = removeEdits(text, ast, grouping);
    return edits === undefined ? text : applyScoutQlEdits(text, edits);
  }
  if (current.grouping === undefined || current.bucket === null) {
    return applyScoutQlEdits(
      text,
      insertEdits({
        text,
        ast,
        target: target.bucket,
        timeColumn,
        timezone: target.timezone,
      }),
    );
  }
  return applyScoutQlEdits(
    text,
    replaceEdits({
      ast,
      grouping: current.grouping,
      current: current.bucket,
      target: target.bucket,
      timeColumn,
      timezone: target.timezone,
    }),
  );
}
