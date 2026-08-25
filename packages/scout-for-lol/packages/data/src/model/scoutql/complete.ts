import { match } from "ts-pattern";
import {
  ReportOutputFormatSchema,
  type ReportOutputFormat,
} from "#src/model/report.ts";
import {
  analyzeScoutQl,
  type ScoutQlAnalysis,
} from "#src/model/scoutql/analyze.ts";
import { SCOUTQL_AGGREGATE_NAMES } from "#src/model/scoutql/analyze-expr-shared.ts";
import {
  scoutQlContextAt,
  type ScoutQlEditorContext,
} from "#src/model/scoutql/editor-context.ts";
import { SCOUTQL_IDIOMS } from "#src/model/scoutql/scoutql-idioms.ts";
import {
  SORT_GROUP,
  aliasItems,
  columnItems,
  functionItems,
  idiomItems,
  keywordItems,
  queueValueItems,
  renderKindItems,
  renderOptionItems,
  renderValueItems,
  sourceItems,
  type ScoutQlCompletionItem,
} from "#src/model/scoutql/complete-items.ts";

// ── completeScoutQl ──────────────────────────────────────────────────────────
// What can go here? The answer comes from the cursor's structural position
// (editor-context.ts) crossed with the analysis of the query so far — never
// from a regex over "the region after WHERE". That matters because the useful
// completions are the contextual ones: the columns of THIS source, the aliases
// THIS query defines, the options THIS render kind accepts.
//
// Results are NOT prefix-filtered. Editors filter and rank with their own
// fuzzy matcher (and would re-filter anyway), and non-editor consumers — the
// AI language tool, docs — want the whole vocabulary for a position.

function renderKindOf(analysis: ScoutQlAnalysis): ReportOutputFormat {
  const raw = analysis.parse.ast.render?.kind;
  const parsed =
    raw === undefined
      ? undefined
      : ReportOutputFormatSchema.safeParse(raw.toUpperCase());
  return parsed?.success === true ? parsed.data : analysis.render.kind;
}

/** Values a specific column accepts, where the language knows them. */
function columnValueItems(column: string | undefined): ScoutQlCompletionItem[] {
  return column === "queue" ? queueValueItems() : [];
}

/** Complete queries, offered at an empty document. */
function starterItems(): ScoutQlCompletionItem[] {
  return SCOUTQL_IDIOMS.map((idiom) => ({
    label: idiom.title,
    insertText: idiom.query,
    insertTextFormat: "plain",
    kind: "snippet",
    detail: idiom.description,
    sortGroup: SORT_GROUP.snippet,
  }));
}

function renderItems(
  context: ScoutQlEditorContext,
  analysis: ScoutQlAnalysis,
): ScoutQlCompletionItem[] {
  const position = context.render;
  if (position === undefined) {
    return [...renderKindItems(), ...keywordItems(["WITH"])];
  }
  const optionName = position.optionName;
  if (optionName !== undefined) {
    return renderValueItems(optionName, analysis);
  }
  return renderOptionItems(renderKindOf(analysis));
}

/** An aggregate argument may not contain another aggregate. */
function insideAggregate(context: ScoutQlEditorContext): boolean {
  const callee = context.call?.callee;
  return callee !== undefined && SCOUTQL_AGGREGATE_NAMES.has(callee);
}

function selectItems(
  context: ScoutQlEditorContext,
  analysis: ScoutQlAnalysis,
): ScoutQlCompletionItem[] {
  return [
    ...columnItems(analysis.source, "select"),
    ...functionItems({ aggregates: !insideAggregate(context) }),
    ...idiomItems("select"),
    ...keywordItems(["AS", "DISTINCT", "FILTER", "FROM"]),
  ];
}

function whereItems(
  context: ScoutQlEditorContext,
  analysis: ScoutQlAnalysis,
): ScoutQlCompletionItem[] {
  return [
    ...columnValueItems(context.valueColumn),
    ...columnItems(analysis.source, "where"),
    // Aggregates are illegal in a row predicate; HAVING is where they belong.
    ...functionItems({ aggregates: false }),
    ...idiomItems("where"),
    ...keywordItems([
      "AND",
      "OR",
      "NOT",
      "IN",
      "BETWEEN",
      "IS NULL",
      "IS NOT NULL",
      "GROUP BY",
      "ORDER BY",
      "LIMIT",
      "RENDER",
    ]),
  ];
}

function itemsFor(
  context: ScoutQlEditorContext,
  analysis: ScoutQlAnalysis,
): ScoutQlCompletionItem[] {
  if (context.atRenderKind) {
    return renderKindItems();
  }
  if (context.clause === "render" || context.render !== undefined) {
    return renderItems(context, analysis);
  }
  return match(context.clause)
    .with("none", () => [...keywordItems(["SELECT"]), ...starterItems()])
    .with("select", () => selectItems(context, analysis))
    .with("from", () => sourceItems())
    .with("where", () => whereItems(context, analysis))
    .with("group-by", () => [
      ...columnItems(analysis.source, "groupBy"),
      ...functionItems({ aggregates: false }),
      ...keywordItems(["ALL", "HAVING", "ORDER BY", "LIMIT", "RENDER"]),
    ])
    .with("having", () => [
      ...aliasItems(analysis),
      ...functionItems({ aggregates: true }),
      ...columnItems(analysis.source, "select"),
      ...keywordItems(["AND", "OR", "NOT", "ORDER BY", "LIMIT", "RENDER"]),
    ])
    .with("order-by", () => [
      ...aliasItems(analysis),
      ...keywordItems(["ASC", "DESC", "LIMIT", "RENDER"]),
    ])
    .with("limit", () => keywordItems(["RENDER"]))
    .exhaustive();
}

/**
 * Completions for an offset in a (possibly unfinished) query, ordered by
 * `sortGroup` then label so the list is stable.
 */
export function completeScoutQl(
  text: string,
  offset: number,
): ScoutQlCompletionItem[] {
  const context = scoutQlContextAt(text, offset);
  const analysis = analyzeScoutQl(text);
  return itemsFor(context, analysis).sort((left, right) => {
    if (left.sortGroup !== right.sortGroup) {
      return left.sortGroup - right.sortGroup;
    }
    return left.label.localeCompare(right.label);
  });
}
