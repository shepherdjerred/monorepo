import {
  ReportChartLabelsSchema,
  ReportChartLegendSchema,
  ReportChartOrientationSchema,
  ReportChartPaletteSchema,
  ReportChartSortSchema,
  ReportChartStackSchema,
  ReportChartThemeSchema,
  ReportDisplayKindSchema,
  ReportOutputFormatSchema,
  type ReportOutputFormat,
} from "#src/model/reports/report.ts";
import { QueueTypeSchema } from "#src/model/core/state.ts";
import { SCOUTQL_CHART_OPTION_NAMES } from "#src/model/scoutql/render-options.ts";
import type { ScoutQlAnalysis } from "#src/model/scoutql/analyze.ts";
import { isChartRenderKind } from "#src/model/scoutql/analyze-render.ts";
import {
  scoutQlSourceCatalogs,
  type ScoutQlColumnInfo,
  type SourceCatalog,
} from "#src/model/scoutql/catalog-columns.ts";
import {
  SCOUTQL_FUNCTIONS,
  type ScoutQlFunctionInfo,
} from "#src/model/scoutql/catalog-functions.ts";
import { scoutQlIdiomSnippets } from "#src/model/scoutql/scoutql-idioms.ts";

// ── Completion item builders ─────────────────────────────────────────────────
// One builder per vocabulary the editor can offer. Everything here reads the
// registries (source catalogs, function registry, render schemas, idioms) so a
// new column or function shows up in completion the day it is added, without a
// second list to maintain.

export type ScoutQlCompletionKind =
  | "keyword"
  | "source"
  | "column"
  | "function"
  | "aggregate"
  | "alias"
  | "snippet"
  | "value"
  | "render-kind"
  | "render-option";

export type ScoutQlCompletionItem = {
  label: string;
  insertText: string;
  /** `snippet` bodies carry `${1:placeholder}` tabstops. */
  insertTextFormat: "plain" | "snippet";
  kind: ScoutQlCompletionKind;
  detail: string;
  /** Lower sorts first; the editor turns it into a sortText prefix. */
  sortGroup: number;
};

/** Sort bands. Contextual answers beat vocabulary; keywords come last. */
export const SORT_GROUP = {
  contextual: 0,
  column: 1,
  function: 2,
  snippet: 3,
  keyword: 4,
} as const;

function isSnippet(body: string): "plain" | "snippet" {
  return body.includes("${") ? "snippet" : "plain";
}

// ── Sources and columns ──────────────────────────────────────────────────────

export function sourceItems(): ScoutQlCompletionItem[] {
  return scoutQlSourceCatalogs().map((catalog) => ({
    label: catalog.id,
    insertText: catalog.id,
    insertTextFormat: "plain",
    kind: "source",
    detail: catalog.description,
    sortGroup: SORT_GROUP.contextual,
  }));
}

export type ColumnContext = "select" | "where" | "groupBy";

function columnAllowed(
  column: ScoutQlColumnInfo,
  context: ColumnContext,
): boolean {
  return column.contexts[context];
}

export function columnItems(
  catalog: SourceCatalog | undefined,
  context: ColumnContext,
): ScoutQlCompletionItem[] {
  if (catalog === undefined) {
    return [];
  }
  return [...catalog.columns.values()]
    .filter((column) => columnAllowed(column, context))
    .map((column) => ({
      label: column.name,
      insertText: column.name,
      insertTextFormat: "plain",
      kind: "column",
      detail: `${column.type}${column.virtual ? " (dimension)" : ""} — ${column.description}`,
      sortGroup: SORT_GROUP.column,
    }));
}

// ── Functions ────────────────────────────────────────────────────────────────

function functionLabel(info: ScoutQlFunctionInfo): string {
  return info.kind === "aggregate" || info.kind === "scalar"
    ? info.name.toUpperCase()
    : info.name;
}

function functionBody(info: ScoutQlFunctionInfo): string {
  if (info.snippet !== undefined) {
    return info.snippet;
  }
  const name = functionLabel(info);
  if (info.maxArgs === 0) {
    return `${name}()`;
  }
  const [signature] = info.signatures;
  const [first] = signature?.params ?? [];
  return `${name}(\${1:${first?.label ?? "x"}})`;
}

export function functionItems(options: {
  aggregates: boolean;
}): ScoutQlCompletionItem[] {
  return SCOUTQL_FUNCTIONS.filter((info) => {
    if (info.kind === "reference") {
      return true;
    }
    const aggregate = info.kind === "aggregate" || info.kind === "macro";
    return aggregate ? options.aggregates : true;
  }).map((info) => {
    const body = functionBody(info);
    const aggregate = info.kind === "aggregate" || info.kind === "macro";
    return {
      label: `${functionLabel(info)}(…)`,
      insertText: body,
      insertTextFormat: isSnippet(body),
      kind: aggregate ? "aggregate" : "function",
      detail: `${info.signatures[0]?.label ?? functionLabel(info)} → ${info.resultType}`,
      sortGroup: SORT_GROUP.function,
    };
  });
}

// ── Outputs, groupings, idioms, keywords ─────────────────────────────────────

export function aliasItems(analysis: ScoutQlAnalysis): ScoutQlCompletionItem[] {
  const outputs: ScoutQlCompletionItem[] = analysis.outputs.map((output) => ({
    label: output.name,
    insertText: output.name,
    insertTextFormat: "plain",
    kind: "alias",
    detail: `output — ${output.displayKind}`,
    sortGroup: SORT_GROUP.contextual,
  }));
  const groupings: ScoutQlCompletionItem[] = analysis.groupings
    .filter(
      (grouping) =>
        !analysis.outputs.some(
          (output) => output.name === grouping.grouping.name,
        ),
    )
    .map((grouping) => ({
      label: grouping.grouping.name,
      insertText: grouping.grouping.name,
      insertTextFormat: "plain",
      kind: "alias",
      detail: `grouping — ${grouping.grouping.kind}`,
      sortGroup: SORT_GROUP.contextual,
    }));
  return [...outputs, ...groupings];
}

export function idiomItems(
  clause: "select" | "where",
): ScoutQlCompletionItem[] {
  return scoutQlIdiomSnippets(clause).map(({ idiom, snippet }) => ({
    label: idiom.title,
    insertText: snippet.body,
    insertTextFormat: isSnippet(snippet.body),
    kind: "snippet",
    detail: idiom.description,
    sortGroup: SORT_GROUP.snippet,
  }));
}

export function keywordItems(
  words: readonly string[],
): ScoutQlCompletionItem[] {
  return words.map((word) => ({
    label: word,
    insertText: word,
    insertTextFormat: "plain",
    kind: "keyword",
    detail: "keyword",
    sortGroup: SORT_GROUP.keyword,
  }));
}

// ── Values ───────────────────────────────────────────────────────────────────

export function queueValueItems(): ScoutQlCompletionItem[] {
  return QueueTypeSchema.options.map((queue) => ({
    label: queue,
    insertText: `'${queue}'`,
    insertTextFormat: "plain",
    kind: "value",
    detail: "queue",
    sortGroup: SORT_GROUP.contextual,
  }));
}

// ── RENDER ───────────────────────────────────────────────────────────────────

export function renderKindItems(): ScoutQlCompletionItem[] {
  return ReportOutputFormatSchema.options.map((format) => ({
    label: format.toLowerCase(),
    insertText: format.toLowerCase(),
    insertTextFormat: "plain",
    kind: "render-kind",
    detail: isChartRenderKind(format) ? "chart" : "text output",
    sortGroup: SORT_GROUP.contextual,
  }));
}

/**
 * Option names per render kind.
 *
 * This mirrors the analyzer's tables in analyze-render.ts. The completion test
 * writes EVERY name offered here into a query and asserts the analyzer accepts
 * it, so an option that drifts out of the language cannot keep being suggested.
 */
export function renderOptionNames(kind: ReportOutputFormat): readonly string[] {
  if (kind === "LIST") {
    return [];
  }
  if (kind === "TABLE") {
    return ["sparkline"];
  }
  if (kind === "LEADERBOARD") {
    return ["mentions"];
  }
  return SCOUTQL_CHART_OPTION_NAMES;
}

export function renderOptionItems(
  kind: ReportOutputFormat,
): ScoutQlCompletionItem[] {
  return renderOptionNames(kind).map((name) => ({
    label: name,
    insertText: `${name} = `,
    insertTextFormat: "plain",
    kind: "render-option",
    detail: `RENDER ${kind.toLowerCase()} option`,
    sortGroup: SORT_GROUP.contextual,
  }));
}

const BOOLEAN_OPTIONS: ReadonlySet<string> = new Set([
  "smooth",
  "cumulative",
  "trend",
  "annotations",
  "sparkline",
]);

const CHANNEL_OPTIONS: ReadonlySet<string> = new Set([
  "x",
  "y",
  "series",
  "size",
  "value",
]);

const ENUM_OPTIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["theme", ReportChartThemeSchema.options],
  ["palette", ReportChartPaletteSchema.options],
  ["orientation", ReportChartOrientationSchema.options],
  ["labels", ReportChartLabelsSchema.options],
  ["legend", ReportChartLegendSchema.options],
  ["sort", ReportChartSortSchema.options],
  ["stack", ReportChartStackSchema.options],
  ["compare", ["previous_period"]],
  ["mentions", ["all"]],
]);

function valueItems(
  values: readonly string[],
  detail: string,
): ScoutQlCompletionItem[] {
  return values.map((value) => ({
    label: value,
    insertText: value,
    insertTextFormat: "plain",
    kind: "value",
    detail,
    sortGroup: SORT_GROUP.contextual,
  }));
}

/** Values for `<option> = …` inside a RENDER option list. */
export function renderValueItems(
  optionName: string,
  analysis: ScoutQlAnalysis,
): ScoutQlCompletionItem[] {
  if (CHANNEL_OPTIONS.has(optionName)) {
    return aliasItems(analysis);
  }
  if (BOOLEAN_OPTIONS.has(optionName)) {
    return valueItems(["true", "false"], "boolean");
  }
  if (optionName === "format") {
    return valueItems(
      ReportDisplayKindSchema.options,
      "display kind — format = (output = kind)",
    );
  }
  const values = ENUM_OPTIONS.get(optionName);
  return values === undefined ? [] : valueItems(values, optionName);
}
