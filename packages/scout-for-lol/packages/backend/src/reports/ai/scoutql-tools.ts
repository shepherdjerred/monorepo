import { tool } from "ai";
import { z } from "zod";
import {
  ReportAiModelPreviewSummarySchema,
  ReportQueryTextSchema,
} from "@scout-for-lol/data";
import { ReportDisplayKindSchema } from "@scout-for-lol/data/model/reports/report.ts";
import {
  QueueTypeSchema,
  queueTypeToDisplayString,
} from "@scout-for-lol/data/model/core/state.ts";
import { SCOUTQL_RENDER_KINDS } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";
import {
  scoutQlSourceCatalogs,
  type ScoutQlColumnInfo,
} from "@scout-for-lol/data/model/scoutql/catalog-columns.ts";
import {
  SCOUTQL_FUNCTIONS,
  type ScoutQlFunctionInfo,
} from "@scout-for-lol/data/model/scoutql/catalog-functions.ts";
import { compileScoutQl } from "@scout-for-lol/data/model/scoutql/compile.ts";
import {
  firstScoutQlError,
  ScoutQlDiagnosticCodeSchema,
  ScoutQlSeveritySchema,
  type ScoutQlDiagnostic,
} from "@scout-for-lol/data/model/scoutql/diagnostics.ts";
import { formatScoutQl } from "@scout-for-lol/data/model/scoutql/format.ts";
import { lintScoutQl } from "@scout-for-lol/data/model/scoutql/lint.ts";
import { SCOUTQL_PRESETS } from "@scout-for-lol/data/model/scoutql/presets.ts";
import { SCOUTQL_CHART_OPTION_NAMES } from "@scout-for-lol/data/model/scoutql/render-options.ts";
import { SCOUTQL_IDIOMS } from "@scout-for-lol/data/model/scoutql/scoutql-idioms.ts";

/**
 * ScoutQL agent tools that do not depend on which population a query runs
 * over: reading the language, validating text, and formatting it.
 *
 * Both the report editor agent (guild-scoped) and the explore agent
 * (global-scoped) build their tool sets from these. Executing a query is
 * deliberately not here — that is the one operation whose meaning depends on
 * scope, so each agent supplies its own preview tool.
 */

/**
 * Counts a tool call against a run's budget and records its outcome. Each
 * agent owns its own limits and metric labels, so the tracker is injected
 * rather than shared.
 */
export type ToolTracker = <T>(
  toolName: string,
  work: () => T | Promise<T>,
) => Promise<T>;

export const EmptyToolInputSchema = z.object({}).strict();
export const ScoutQlQueryToolInputSchema = z
  .object({ queryText: ReportQueryTextSchema })
  .strict();

/**
 * One diagnostic, as the model sees it.
 *
 * The span is what makes this repairable rather than guessable: a model that
 * is told which characters are wrong edits those characters, while a model
 * given only prose re-drafts the whole query and loses the parts that worked.
 * Fix titles are carried too, so a repair the language already knows how to
 * make ("cast to INT", "add a 30-day time bound") reads as an instruction
 * instead of being rediscovered.
 */
export const DiagnosticReportSchema = z
  .object({
    code: ScoutQlDiagnosticCodeSchema,
    severity: ScoutQlSeveritySchema,
    message: z.string(),
    /** 0-based character offsets into the submitted query text. */
    span: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      })
      .strict(),
    /** Titles of the machine-applicable repairs the language offers. */
    fixes: z.array(z.string()),
  })
  .strict();

export const ValidationToolOutputSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    diagnostics: z.array(DiagnosticReportSchema),
    formattedQueryText: z.string().nullable(),
  })
  .strict();

export type ValidationToolOutput = z.infer<typeof ValidationToolOutputSchema>;

/**
 * What a tool that actually executes a query returns. Shared because the
 * contract is identical whichever population the query ran over; only the
 * scope the executing agent supplies differs.
 */
export const QueryResultToolOutputSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    formattedQueryText: z.string().nullable(),
    preview: ReportAiModelPreviewSummarySchema.nullable(),
  })
  .strict();

export const FormatToolOutputSchema = z
  .object({
    formattedQueryText: z.string(),
  })
  .strict();

const LanguageColumnSchema = z
  .object({
    name: z.string(),
    /** DuckDB type, lowercased (`varchar`, `integer`, `double`, `boolean`, …). */
    type: z.string(),
    description: z.string(),
    /** How the raw column formats; aggregates over it may inherit this. */
    displayKind: ReportDisplayKindSchema,
    /** Computed by the engine (a dimension), not a physical lake column. */
    virtual: z.boolean(),
    /** Clauses this column may appear in. */
    usableIn: z.array(z.enum(["select", "where", "group_by"])),
  })
  .strict();

const LanguageFunctionSchema = z
  .object({
    name: z.string(),
    /** Every accepted call form, e.g. `COUNT(*)`, `COUNT(DISTINCT x)`. */
    signatures: z.array(z.string()),
    resultType: z.string(),
    doc: z.string(),
    acceptsStar: z.boolean(),
    acceptsDistinct: z.boolean(),
    acceptsFilter: z.boolean(),
  })
  .strict();

/**
 * The complete ScoutQL vocabulary, generated from the language's own
 * registries.
 *
 * Everything here is derived — there is no hand-maintained copy of a column,
 * a function, or an idiom in this file. That is the whole point: the metric
 * enum this replaced drifted from the engine repeatedly, and a model told
 * about a column that no longer exists writes a query that no longer runs.
 */
export const LanguageToolOutputSchema = z
  .object({
    sources: z.array(
      z
        .object({
          id: z.string(),
          description: z.string(),
          /**
           * The timestamp column a time bound must use. `null` means the
           * source is a point-in-time snapshot with no history to bound.
           */
          timeColumn: z.string().nullable(),
          requiresCompetitionId: z.boolean(),
          /** Whether `player('…')` resolves against this source. */
          supportsPlayerReference: z.boolean(),
          /** Whether `GROUP BY group(n|all)` applies. */
          supportsGroupCall: z.boolean(),
          columns: z.array(LanguageColumnSchema),
        })
        .strict(),
    ),
    aggregateFunctions: z.array(LanguageFunctionSchema),
    scalarFunctions: z.array(LanguageFunctionSchema),
    /** Scout-specific expansions: `kda()`, `per_minute(x)`. */
    macroFunctions: z.array(LanguageFunctionSchema),
    /** Entity lookups: `player('…')`, `champion('…')`. */
    referenceFunctions: z.array(LanguageFunctionSchema),
    /** What `RENDER <kind>` accepts, with the description that says when to
     * reach for it — the model has to choose one, and "bump_chart" alone does
     * not say it plots rank movement over time. */
    renderKinds: z.array(
      z
        .object({
          id: z.string(),
          label: z.string(),
          description: z.string(),
          isChart: z.boolean(),
        })
        .strict(),
    ),
    /** Option names accepted inside `RENDER <kind> WITH (…)`. */
    renderOptions: z.array(z.string()),
    idioms: z.array(
      z
        .object({
          id: z.string(),
          title: z.string(),
          description: z.string(),
          query: z.string(),
        })
        .strict(),
    ),
    queues: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
    presets: z.array(
      z
        .object({
          id: z.string(),
          category: z.string(),
          title: z.string(),
          description: z.string(),
          query: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

export type LanguageToolOutput = z.infer<typeof LanguageToolOutputSchema>;

function describeColumn(
  column: ScoutQlColumnInfo,
): z.infer<typeof LanguageColumnSchema> {
  const usableIn: ("select" | "where" | "group_by")[] = [];
  if (column.contexts.select) usableIn.push("select");
  if (column.contexts.where) usableIn.push("where");
  if (column.contexts.groupBy) usableIn.push("group_by");
  return {
    name: column.name,
    type: column.type,
    description: column.description,
    displayKind: column.displayKind,
    virtual: column.virtual,
    usableIn,
  };
}

function describeFunction(
  info: ScoutQlFunctionInfo,
): z.infer<typeof LanguageFunctionSchema> {
  return {
    name: info.name,
    signatures: info.signatures.map((signature) => signature.label),
    resultType: info.resultType,
    doc: info.docMarkdown,
    acceptsStar: info.acceptsStar,
    acceptsDistinct: info.acceptsDistinct,
    acceptsFilter: info.acceptsFilter,
  };
}

/**
 * Functions split by kind. The `Record` key set is the exhaustiveness check:
 * a new kind in the registry fails typecheck here rather than silently
 * vanishing from the vocabulary the model is given.
 */
function functionsByKind(): Record<
  ScoutQlFunctionInfo["kind"],
  z.infer<typeof LanguageFunctionSchema>[]
> {
  const byKind: Record<
    ScoutQlFunctionInfo["kind"],
    z.infer<typeof LanguageFunctionSchema>[]
  > = { aggregate: [], scalar: [], macro: [], reference: [] };
  for (const info of SCOUTQL_FUNCTIONS) {
    byKind[info.kind].push(describeFunction(info));
  }
  return byKind;
}

/** The generated language catalog shared by prompts and the reference tool. */
export function scoutQlLanguageReference(): LanguageToolOutput {
  const functions = functionsByKind();
  return {
    sources: scoutQlSourceCatalogs().map((catalog) => ({
      id: catalog.id,
      description: catalog.description,
      timeColumn: catalog.timeColumn,
      requiresCompetitionId: catalog.requiresCompetitionId,
      supportsPlayerReference: catalog.playerRefAllowed,
      supportsGroupCall: catalog.groupCall,
      columns: [...catalog.columns.values()].map((column) =>
        describeColumn(column),
      ),
    })),
    aggregateFunctions: functions.aggregate,
    scalarFunctions: functions.scalar,
    macroFunctions: functions.macro,
    referenceFunctions: functions.reference,
    renderKinds: SCOUTQL_RENDER_KINDS.map((kind) => ({
      id: kind.id,
      label: kind.label,
      description: kind.description,
      isChart: kind.isChart,
    })),
    renderOptions: [...SCOUTQL_CHART_OPTION_NAMES],
    idioms: SCOUTQL_IDIOMS.map((idiom) => ({
      id: idiom.id,
      title: idiom.title,
      description: idiom.description,
      query: idiom.query,
    })),
    queues: QueueTypeSchema.options.map((queue) => ({
      id: queue,
      label: queueTypeToDisplayString(queue),
    })),
    presets: SCOUTQL_PRESETS.map((preset) => ({
      id: preset.id,
      category: preset.category,
      title: preset.title,
      description: preset.description,
      query: preset.query,
    })),
  };
}

function reportDiagnostic(
  diagnostic: ScoutQlDiagnostic,
): z.infer<typeof DiagnosticReportSchema> {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    span: { start: diagnostic.span.start, end: diagnostic.span.end },
    fixes: (diagnostic.fixes ?? []).map((fix) => fix.title),
  };
}

/**
 * Lint, compile, and format one ScoutQL query without executing it.
 *
 * A compile failure is a tool result rather than a thrown error: the agent is
 * expected to read the diagnostics and try again, which is the whole point of
 * giving it a validate step.
 *
 * Advisory diagnostics are returned on the success path too. The one that
 * matters is `time-window-unbounded`: an unbounded query is valid and means
 * all ingested history, so the only way the model learns it wrote one is if
 * we say so.
 */
export function validateQuery(queryText: string): ValidationToolOutput {
  const diagnostics = lintScoutQl(queryText);
  const reported = diagnostics.map((diagnostic) =>
    reportDiagnostic(diagnostic),
  );
  const firstError = firstScoutQlError(diagnostics);
  if (firstError !== undefined) {
    return {
      ok: false,
      message: firstError.message,
      diagnostics: reported,
      formattedQueryText: null,
    };
  }

  // A post-condition, not a second opinion: `compileScoutQl` refuses exactly
  // the queries `lintScoutQl` marks error-severity, both from the same
  // analysis pass. A throw here is a bug in the language, not bad user input,
  // so it must not be swallowed into a tool result the model retries forever.
  compileScoutQl(queryText);
  const advisory = reported[0];
  return {
    ok: true,
    message:
      advisory === undefined
        ? "Query is valid."
        : `Query is valid. ${advisory.severity}: ${advisory.message}`,
    diagnostics: reported,
    formattedQueryText: formatScoutQl(queryText),
  };
}

export function createLanguageTool(track: ToolTracker) {
  return tool({
    description:
      "Read the complete ScoutQL vocabulary: every source and its columns, the aggregate/scalar/macro/reference functions, render kinds and options, queue values, worked idioms, and ready-made presets.",
    inputSchema: EmptyToolInputSchema,
    outputSchema: LanguageToolOutputSchema,
    execute: () =>
      track("get_report_language", () => scoutQlLanguageReference()),
  });
}

export function createValidateTool(track: ToolTracker) {
  return tool({
    description:
      "Validate a ScoutQL report query without running it. Returns coded diagnostics with character spans into the submitted text (plus any fix titles) so a failure can be repaired in place, and the canonically formatted query when it compiles.",
    inputSchema: ScoutQlQueryToolInputSchema,
    outputSchema: ValidationToolOutputSchema,
    execute: (inputData) =>
      track("validate_report_query", () => validateQuery(inputData.queryText)),
  });
}

export function createFormatTool(track: ToolTracker) {
  return tool({
    description: "Format valid ScoutQL report query text for display.",
    inputSchema: ScoutQlQueryToolInputSchema,
    outputSchema: FormatToolOutputSchema,
    execute: (inputData) =>
      track("format_report_query", () => ({
        formattedQueryText: formatScoutQl(inputData.queryText),
      })),
  });
}
