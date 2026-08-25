import { match } from "ts-pattern";
import { QueueTypeSchema, queueTypeToDisplayString } from "@scout-for-lol/data";
import { scoutQlSourceCatalogs } from "@scout-for-lol/data/model/scoutql/catalog-columns.ts";
import {
  SCOUTQL_FUNCTIONS,
  type ScoutQlFunctionInfo,
  type ScoutQlFunctionKind,
} from "@scout-for-lol/data/model/scoutql/catalog-functions.ts";
import { SCOUTQL_RENDER_KINDS } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";
import { SCOUTQL_CHART_OPTION_NAMES } from "@scout-for-lol/data/model/scoutql/render-options.ts";
import { SCOUTQL_KEYWORDS } from "@scout-for-lol/data/model/scoutql/tokens.ts";

// ── The in-app reference, as data ────────────────────────────────────────────
// Every section here is BUILT from the same registries the parser, analyzer
// and editor read: the source catalogs, the function registry, the render-kind
// catalog, the option-name list and the token definitions. Nothing about the
// language is retyped, which is the whole reason the old reference could sit
// there describing clauses the language had stopped having.

export type DocsDefinition = { term: string; description: string };

export type DocsSourceSection = {
  id: string;
  description: string;
  /** How a time bound is written for this source, or why it takes none. */
  timeNote: string;
  columns: DocsDefinition[];
};

export function scoutQlSourceSections(): DocsSourceSection[] {
  return scoutQlSourceCatalogs().map((catalog) => ({
    id: catalog.id,
    description: catalog.description,
    timeNote:
      catalog.timeColumn === null
        ? "A point-in-time snapshot: it holds no history, so it takes no time bound."
        : `Time bounds filter ${catalog.timeColumn}.`,
    columns: [...catalog.columns.values()].map((column) => ({
      term: column.name,
      description: `${column.type}${column.virtual ? " · dimension" : ""} — ${column.description}${columnContextNote(
        column.contexts,
      )}`,
    })),
  }));
}

function columnContextNote(contexts: {
  select: boolean;
  where: boolean;
  groupBy: boolean;
}): string {
  const places = [
    ...(contexts.select ? ["SELECT"] : []),
    ...(contexts.where ? ["WHERE"] : []),
    ...(contexts.groupBy ? ["GROUP BY"] : []),
  ];
  // Most columns are usable everywhere; only say so when they are not.
  return places.length === 3 ? "" : ` (${places.join(" / ")} only)`;
}

export type DocsFunctionSection = {
  title: string;
  blurb: string;
  items: DocsDefinition[];
};

const FUNCTION_KINDS = [
  "aggregate",
  "scalar",
  "macro",
  "reference",
] as const satisfies readonly ScoutQlFunctionKind[];

const FUNCTION_SECTION_TITLE: Record<ScoutQlFunctionKind, string> = {
  aggregate: "Aggregate functions",
  scalar: "Scalar functions",
  macro: "Scout macros",
  reference: "References",
};

/** The function registry, split by kind, in registry order. */
export function scoutQlFunctionSections(): DocsFunctionSection[] {
  return FUNCTION_KINDS.map((kind) => ({
    title: FUNCTION_SECTION_TITLE[kind],
    blurb: functionKindBlurb(kind),
    items: SCOUTQL_FUNCTIONS.filter((info) => info.kind === kind).map((info) =>
      functionDefinition(info),
    ),
  }));
}

function functionDefinition(info: ScoutQlFunctionInfo): DocsDefinition {
  const labels = info.signatures.map((signature) => signature.label);
  return {
    term: labels.join(" · "),
    // The registry's markdown is one paragraph of prose; the reference shows it
    // as plain text rather than rendering a second markdown surface.
    description: `${info.docMarkdown.replaceAll("`", "")} Returns ${info.resultType}.`,
  };
}

/**
 * The two time-bound shapes the compiler recognizes structurally, plus the
 * consequence of writing neither. Omission is legal and is the single most
 * surprising thing about the language, so it is stated first.
 */
export function scoutQlTimeBoundItems(): DocsDefinition[] {
  return [
    {
      term: "(no time filter)",
      description:
        "Every game Scout has ever ingested. Legal, occasionally what you want, and almost never what you meant — the editor warns on it.",
    },
    {
      term: "<time> >= CURRENT_TIMESTAMP - INTERVAL <n> DAY",
      description:
        "A rolling window ending now. WEEK, MONTH and YEAR work too. This is the ordinary bound.",
    },
    {
      term: "(<time> AT TIME ZONE '<zone>')::DATE BETWEEN '<start>' AND '<end>'",
      description:
        "Fixed calendar dates, both ends inclusive, measured in the named IANA zone. Drop the AT TIME ZONE for UTC.",
    },
    {
      term: "GROUP BY DATE_TRUNC('week', <time>)",
      description:
        "Buckets the window into a time series. Use 'day', 'week' or 'month' — or GROUP BY patch for Riot's patches.",
    },
    {
      term: "RENDER <kind> WITH (compare = previous_period)",
      description:
        "Overlays the equally long span immediately before the window. Needs a stated window and a time bucket.",
    },
  ];
}

export function scoutQlRenderKindItems(): DocsDefinition[] {
  return SCOUTQL_RENDER_KINDS.map((kind) => ({
    term: kind.id,
    description: `${kind.isChart ? "Chart" : "Text"} — ${kind.description}`,
  }));
}

/**
 * The option names a `WITH (…)` list accepts. Only the names are listed: what
 * each one means lives in the analyzer, and the editor's completions and hover
 * read it from there, so writing the meanings out here would recreate exactly
 * the drifting second copy this reference was rebuilt to remove.
 */
export function scoutQlRenderOptionNames(): readonly string[] {
  return SCOUTQL_CHART_OPTION_NAMES;
}

export function scoutQlKeywordList(): readonly string[] {
  return [...SCOUTQL_KEYWORDS].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

export function scoutQlQueueItems(): DocsDefinition[] {
  return QueueTypeSchema.options.map((queue) => ({
    term: `'${queue}'`,
    description: queueTypeToDisplayString(queue),
  }));
}

/** How a function kind is introduced in the reference's prose. */
function functionKindBlurb(kind: ScoutQlFunctionKind): string {
  return match(kind)
    .with(
      "aggregate",
      () =>
        "Every one of these accepts FILTER (WHERE …) for a conditional cut.",
    )
    .with("scalar", () => "Row-level maths, applied before aggregation.")
    .with(
      "macro",
      () => "Scout shorthands that expand to ordinary SQL when compiled.",
    )
    .with(
      "reference",
      () => "Resolve a name to the identifier the lake stores.",
    )
    .exhaustive();
}
