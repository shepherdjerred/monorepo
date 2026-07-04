import { z } from "zod";
import type { ReportAiStreamEvent } from "@scout-for-lol/data";

const ReportAgentStreamChunkSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("step-start") }),
  z.looseObject({
    type: z.literal("text-delta"),
    payload: z.looseObject({ text: z.string() }),
  }),
  z.looseObject({
    type: z.literal("tool-call"),
    payload: z.looseObject({ toolName: z.string() }),
  }),
  z.looseObject({
    type: z.literal("tool-result"),
    payload: z.looseObject({
      toolName: z.string(),
      isError: z.boolean().optional(),
    }),
  }),
  z.looseObject({
    type: z.literal("tool-error"),
    payload: z.looseObject({
      toolName: z.string(),
      error: z.unknown(),
    }),
  }),
  z.looseObject({
    type: z.literal("error"),
    payload: z.looseObject({ error: z.unknown() }),
  }),
]);

export async function emitReportAgentStreamChunk(
  rawChunk: unknown,
  emit: (event: ReportAiStreamEvent) => void | Promise<void>,
): Promise<void> {
  const parsed = ReportAgentStreamChunkSchema.safeParse(rawChunk);
  if (!parsed.success) {
    return;
  }
  const chunk = parsed.data;
  switch (chunk.type) {
    case "step-start": {
      await emit({
        type: "step_started",
        message: "The agent started a query editing step.",
      });
      break;
    }
    case "text-delta": {
      if (chunk.payload.text.length > 0) {
        await emit({ type: "draft_delta", text: chunk.payload.text });
      }
      break;
    }
    case "tool-call": {
      await emit({
        type: "tool_call",
        toolName: chunk.payload.toolName,
        message: toolCallMessage(chunk.payload.toolName),
      });
      break;
    }
    case "tool-result": {
      await emit({
        type: "tool_result",
        toolName: chunk.payload.toolName,
        ok: chunk.payload.isError !== true,
        message: toolResultMessage(
          chunk.payload.toolName,
          chunk.payload.isError,
        ),
      });
      break;
    }
    case "tool-error": {
      await emit({
        type: "tool_result",
        toolName: chunk.payload.toolName,
        ok: false,
        message: `Tool failed: ${errorMessage(chunk.payload.error)}`,
      });
      break;
    }
    case "error": {
      throw new Error(errorMessage(chunk.payload.error));
    }
  }
}

function toolCallMessage(toolName: string): string {
  if (toolName === "get_report_language") {
    return "Reading ScoutQL reference.";
  }
  if (toolName === "validate_report_query") {
    return "Validating the query.";
  }
  if (toolName === "preview_report_query") {
    return "Previewing the query against server data.";
  }
  if (toolName === "format_report_query") {
    return "Formatting the query.";
  }
  return `Running ${toolName}.`;
}

function toolResultMessage(
  toolName: string,
  isError: boolean | undefined,
): string {
  if (isError === true) {
    return `${toolName} returned an error.`;
  }
  if (toolName === "preview_report_query") {
    return "Preview completed.";
  }
  if (toolName === "validate_report_query") {
    return "Validation completed.";
  }
  return `${toolName} completed.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
