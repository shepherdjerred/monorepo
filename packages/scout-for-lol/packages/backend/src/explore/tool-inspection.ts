import { z } from "zod";
import type { ExploreTraceDetails } from "@scout-for-lol/data";
import {
  EmptyToolInputSchema,
  FormatToolOutputSchema,
  LanguageToolOutputSchema,
  QueryResultToolOutputSchema,
  ScoutQlQueryToolInputSchema,
  ValidationToolOutputSchema,
} from "#src/reports/ai/scoutql-tools.ts";

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
  return { succeeded: true, details: null, rawOutput: null };
}

function boundedDiagnostics(diagnostics: string[]): string[] {
  const visible = diagnostics
    .slice(0, 5)
    .map((diagnostic) =>
      diagnostic.length <= 500
        ? diagnostic
        : `${diagnostic.slice(0, 499).trimEnd()}…`,
    );
  if (diagnostics.length > visible.length) {
    visible.push(
      `${(diagnostics.length - visible.length).toString()} more diagnostics omitted.`,
    );
  }
  return visible;
}

function referenceDetails(
  output: z.infer<typeof LanguageToolOutputSchema> | null,
): ExploreTraceDetails {
  return {
    kind: "reference",
    sources: output?.sources.length ?? null,
    metrics: output?.metrics.length ?? null,
    functions: output?.functions.length ?? null,
    groupBys: output?.groupBys.length ?? null,
    filters: output?.filters.length ?? null,
    renderKinds: output?.renderKinds.length ?? null,
    renderOptions: output?.renderOptions.length ?? null,
    queues: output?.queues.length ?? null,
    presets: output?.presets.length ?? null,
  };
}
