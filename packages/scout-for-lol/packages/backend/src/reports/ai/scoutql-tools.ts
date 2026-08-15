import { tool } from "ai";
import { z } from "zod";
import {
  ReportAiPreviewSummarySchema,
  formatReportQuery,
  lintReportQuery,
  parseAndCompile,
  reportQueueValues,
  REPORT_COMMON_PRESETS,
  REPORT_FILTERS,
  REPORT_FUNCTIONS,
  REPORT_GROUP_BYS,
  REPORT_METRICS,
  REPORT_RENDER_KINDS,
  REPORT_RENDER_OPTIONS,
  REPORT_SOURCES,
  ReportQueryTextSchema,
} from "@scout-for-lol/data";

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

export const ValidationToolOutputSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    diagnostics: z.array(z.string()),
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
    preview: ReportAiPreviewSummarySchema.nullable(),
  })
  .strict();

const FormatToolOutputSchema = z
  .object({
    formattedQueryText: z.string(),
  })
  .strict();

const LanguageToolOutputSchema = z
  .object({
    sources: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
        validGroupBys: z.array(z.string()),
      }),
    ),
    metrics: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
        kind: z.string(),
      }),
    ),
    functions: z.array(
      z.object({
        id: z.string(),
        syntax: z.string(),
        description: z.string(),
      }),
    ),
    groupBys: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
      }),
    ),
    filters: z.array(
      z.object({
        syntax: z.string(),
        description: z.string(),
      }),
    ),
    renderKinds: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        description: z.string(),
      }),
    ),
    renderOptions: z.array(
      z.object({
        id: z.string(),
        syntax: z.string(),
        description: z.string(),
      }),
    ),
    queues: z.array(z.object({ id: z.string(), label: z.string() })),
    presets: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        query: z.string(),
      }),
    ),
  })
  .strict();

function languagePayload(): z.infer<typeof LanguageToolOutputSchema> {
  return {
    sources: REPORT_SOURCES,
    metrics: REPORT_METRICS,
    functions: REPORT_FUNCTIONS,
    groupBys: REPORT_GROUP_BYS,
    filters: REPORT_FILTERS,
    renderKinds: REPORT_RENDER_KINDS,
    renderOptions: REPORT_RENDER_OPTIONS,
    queues: reportQueueValues(),
    presets: REPORT_COMMON_PRESETS.map((preset) => ({
      title: preset.title,
      description: preset.description,
      query: preset.query,
    })),
  };
}

/**
 * Lint, compile, and format one ScoutQL query without executing it.
 *
 * A compile failure is a tool result rather than a thrown error: the agent is
 * expected to read the diagnostics and try again, which is the whole point of
 * giving it a validate step.
 */
export function validateQuery(queryText: string): ValidationToolOutput {
  const diagnostics = lintReportQuery(queryText)
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.message);
  if (diagnostics.length > 0) {
    return {
      ok: false,
      message: diagnostics[0] ?? "The query is invalid.",
      diagnostics,
      formattedQueryText: null,
    };
  }

  try {
    parseAndCompile(queryText);
    return {
      ok: true,
      message: "Query is valid.",
      diagnostics: [],
      formattedQueryText: formatReportQuery(queryText),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message,
      diagnostics: [message],
      formattedQueryText: null,
    };
  }
}

export function createLanguageTool(track: ToolTracker) {
  return tool({
    description:
      "Read ScoutQL sources, metrics, expressions, groupings, filters, render kinds/options, queues, and common examples.",
    inputSchema: z.object({}).strict(),
    outputSchema: LanguageToolOutputSchema,
    execute: () => track("get_report_language", () => languagePayload()),
  });
}

export function createValidateTool(track: ToolTracker) {
  return tool({
    description:
      "Validate a ScoutQL report query and return diagnostics plus formatted text.",
    inputSchema: z.object({ queryText: ReportQueryTextSchema }).strict(),
    outputSchema: ValidationToolOutputSchema,
    execute: (inputData) =>
      track("validate_report_query", () => validateQuery(inputData.queryText)),
  });
}

export function createFormatTool(track: ToolTracker) {
  return tool({
    description: "Format valid ScoutQL report query text for display.",
    inputSchema: z.object({ queryText: ReportQueryTextSchema }).strict(),
    outputSchema: FormatToolOutputSchema,
    execute: (inputData) =>
      track("format_report_query", () => ({
        formattedQueryText: formatReportQuery(inputData.queryText),
      })),
  });
}
