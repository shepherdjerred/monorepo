import { z } from "zod";
import type { ExploreTraceDetails } from "@scout-for-lol/data";
import {
  BucksAccountQueryResultSchema,
  BucksAccountQuerySchema,
  BucksAskDatasetOverviewSchema,
  BucksBetQueryResultSchema,
  BucksBetQuerySchema,
  BucksLedgerQueryResultSchema,
  BucksLedgerQuerySchema,
} from "#src/betting/ask-analytics-schema.ts";
import {
  EmptyToolInputSchema,
  FormatToolOutputSchema,
  LanguageToolOutputSchema,
  QueryResultToolOutputSchema,
  ScoutQlQueryToolInputSchema,
  ValidationToolOutputSchema,
} from "#src/reports/ai/scoutql-tools.ts";
import {
  DareActionToolInputSchema,
  DareDefinitionToolInputSchema,
  DareDeleteToolInputSchema,
  DareInspectToolInputSchema,
  DareListToolInputSchema,
  DarePreviewToolInputSchema,
  DareToolResultSchema,
  ReviseDareToolInputSchema,
} from "#src/explore/dare-tools.ts";

/**
 * The Bryan Bucks tools' validated shapes, keyed by tool name. They carry no
 * curated `details` — the closed `ExploreTraceDetails` union is persisted data
 * and extending it buys little for a one-guild feature — but their raw values
 * are validated before entering the trace like every other tool's.
 */
const BUCKS_TOOL_SCHEMAS = new Map<
  string,
  { input: z.ZodType; output: z.ZodType }
>([
  [
    "get_bucks_dataset",
    { input: EmptyToolInputSchema, output: BucksAskDatasetOverviewSchema },
  ],
  [
    "query_bucks_accounts",
    { input: BucksAccountQuerySchema, output: BucksAccountQueryResultSchema },
  ],
  [
    "query_bucks_ledger",
    { input: BucksLedgerQuerySchema, output: BucksLedgerQueryResultSchema },
  ],
  [
    "query_bucks_bets",
    { input: BucksBetQuerySchema, output: BucksBetQueryResultSchema },
  ],
]);

const DARE_TOOL_SCHEMAS = new Map<
  string,
  { input: z.ZodType; output: z.ZodType }
>([
  [
    "get_dare_language",
    { input: EmptyToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "validate_dare_contract",
    { input: DareDefinitionToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "preview_dare_contract",
    { input: DarePreviewToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "create_dare_draft",
    { input: DareDefinitionToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "revise_dare_draft",
    { input: ReviseDareToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "list_dares",
    { input: DareListToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "inspect_dare",
    { input: DareInspectToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "prepare_dare_action",
    { input: DareActionToolInputSchema, output: DareToolResultSchema },
  ],
  [
    "delete_dare_draft",
    { input: DareDeleteToolInputSchema, output: DareToolResultSchema },
  ],
]);

const JsonValueSchema = z.json();
type JsonValue = z.infer<typeof JsonValueSchema>;

export type ExploreToolCallInspection = {
  details: ExploreTraceDetails | null;
  rawInput: JsonValue | null;
};

export type ExploreToolResultInspection = {
  succeeded: boolean;
  details: ExploreTraceDetails | null;
  rawOutput: JsonValue | null;
};

/** Validate and project a tool input before it can enter the browser trace. */
export function inspectExploreToolCall(
  toolName: string,
  input: unknown,
): ExploreToolCallInspection {
  if (toolName === "get_report_language") {
    const parsed = EmptyToolInputSchema.parse(input);
    return {
      rawInput: JsonValueSchema.parse(parsed),
      details: referenceDetails(null),
    };
  }
  if (toolName === "validate_report_query") {
    const parsed = ScoutQlQueryToolInputSchema.parse(input);
    return {
      rawInput: JsonValueSchema.parse(parsed),
      details: {
        kind: "validation",
        queryText: parsed.queryText,
        ok: null,
        diagnostics: [],
        formattedQueryText: null,
      },
    };
  }
  if (toolName === "format_report_query") {
    const parsed = ScoutQlQueryToolInputSchema.parse(input);
    return {
      rawInput: JsonValueSchema.parse(parsed),
      details: {
        kind: "format",
        queryText: parsed.queryText,
        formattedQueryText: null,
      },
    };
  }
  if (toolName === "run_report_query") {
    const parsed = ScoutQlQueryToolInputSchema.parse(input);
    return {
      rawInput: JsonValueSchema.parse(parsed),
      details: {
        kind: "execution",
        queryText: parsed.queryText,
        ok: null,
        rowsReturned: null,
        rowsScanned: null,
        renderKind: null,
      },
    };
  }
  const bucks = BUCKS_TOOL_SCHEMAS.get(toolName);
  if (bucks !== undefined) {
    return {
      rawInput: JsonValueSchema.parse(bucks.input.parse(input)),
      details: null,
    };
  }
  const dare = DARE_TOOL_SCHEMAS.get(toolName);
  if (dare !== undefined) {
    return {
      rawInput: JsonValueSchema.parse(dare.input.parse(input)),
      details: null,
    };
  }
  return { details: null, rawInput: null };
}

/** Validate and reduce a tool result into safe shared details plus owner data. */
export function inspectExploreToolResult(
  toolName: string,
  input: unknown,
  output: unknown,
): ExploreToolResultInspection {
  if (toolName === "get_report_language") {
    EmptyToolInputSchema.parse(input);
    const parsed = LanguageToolOutputSchema.parse(output);
    return {
      succeeded: true,
      rawOutput: JsonValueSchema.parse(parsed),
      details: referenceDetails(parsed),
    };
  }
  if (toolName === "validate_report_query") {
    const parsedInput = ScoutQlQueryToolInputSchema.parse(input);
    const parsedOutput = ValidationToolOutputSchema.parse(output);
    return {
      succeeded: parsedOutput.ok,
      rawOutput: JsonValueSchema.parse(parsedOutput),
      details: {
        kind: "validation",
        queryText: parsedInput.queryText,
        ok: parsedOutput.ok,
        diagnostics: boundedDiagnostics(parsedOutput.diagnostics),
        formattedQueryText: parsedOutput.formattedQueryText,
      },
    };
  }
  if (toolName === "format_report_query") {
    const parsedInput = ScoutQlQueryToolInputSchema.parse(input);
    const parsedOutput = FormatToolOutputSchema.parse(output);
    return {
      succeeded: true,
      rawOutput: JsonValueSchema.parse(parsedOutput),
      details: {
        kind: "format",
        queryText: parsedInput.queryText,
        formattedQueryText: parsedOutput.formattedQueryText,
      },
    };
  }
  if (toolName === "run_report_query") {
    const parsedInput = ScoutQlQueryToolInputSchema.parse(input);
    const parsedOutput = QueryResultToolOutputSchema.parse(output);
    return {
      succeeded: parsedOutput.ok,
      rawOutput: JsonValueSchema.parse(parsedOutput),
      details: {
        kind: "execution",
        queryText: parsedInput.queryText,
        ok: parsedOutput.ok,
        rowsReturned: parsedOutput.preview?.rowsReturned ?? null,
        rowsScanned: parsedOutput.preview?.rowsScanned ?? null,
        renderKind: parsedOutput.preview?.renderKind ?? null,
      },
    };
  }
  const bucks = BUCKS_TOOL_SCHEMAS.get(toolName);
  if (bucks !== undefined) {
    bucks.input.parse(input);
    // These tools throw on failure, so a delivered result is a success.
    return {
      succeeded: true,
      rawOutput: JsonValueSchema.parse(bucks.output.parse(output)),
      details: null,
    };
  }
  const dare = DARE_TOOL_SCHEMAS.get(toolName);
  if (dare !== undefined) {
    dare.input.parse(input);
    const parsed = DareToolResultSchema.parse(dare.output.parse(output));
    return {
      succeeded: ![
        "invalid",
        "not_found",
        "not_editable",
        "forbidden",
        "feature_disabled",
        "stale_revision",
      ].includes(parsed.kind),
      rawOutput: JsonValueSchema.parse(parsed),
      details: null,
    };
  }
  return { succeeded: true, details: null, rawOutput: null };
}

/**
 * The trace carries diagnostics as display lines, not as structure: it is a
 * read-only "what did the agent do" panel, and the code and span are what make
 * a line self-explanatory to someone reading it after the fact.
 */
function boundedDiagnostics(
  diagnostics: z.infer<typeof ValidationToolOutputSchema>["diagnostics"],
): string[] {
  const visible = diagnostics.slice(0, 5).map((diagnostic) => {
    const line = `[${diagnostic.code}] ${diagnostic.message} (${diagnostic.span.start.toString()}–${diagnostic.span.end.toString()})`;
    return line.length <= 500 ? line : `${line.slice(0, 499).trimEnd()}…`;
  });
  if (diagnostics.length > visible.length) {
    visible.push(
      `${(diagnostics.length - visible.length).toString()} more diagnostics omitted.`,
    );
  }
  return visible;
}

/**
 * Counts of what the reference tool returned.
 *
 * The v1 keys (`metrics`, `groupBys`, `filters`) are simply omitted: those
 * vocabularies no longer exist, and the trace schema keeps them optional only
 * so traces stored before the cutover still parse and still render their own
 * counts. What v2 reads instead is how many columns and idioms the turn saw.
 */
function referenceDetails(
  output: z.infer<typeof LanguageToolOutputSchema> | null,
): ExploreTraceDetails {
  const functions =
    output === null
      ? null
      : output.aggregateFunctions.length +
        output.scalarFunctions.length +
        output.macroFunctions.length +
        output.referenceFunctions.length;
  const columns =
    output === null
      ? null
      : output.sources.reduce(
          (total, source) => total + source.columns.length,
          0,
        );
  return {
    kind: "reference",
    sources: output?.sources.length ?? null,
    columns,
    functions,
    aggregateFunctions: output?.aggregateFunctions.length ?? null,
    scalarFunctions: output?.scalarFunctions.length ?? null,
    idioms: output?.idioms.length ?? null,
    renderKinds: output?.renderKinds.length ?? null,
    renderOptions: output?.renderOptions.length ?? null,
    queues: output?.queues.length ?? null,
    presets: output?.presets.length ?? null,
  };
}
