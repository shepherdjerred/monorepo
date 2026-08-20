import type { ReportAiStreamEvent } from "@scout-for-lol/data";
import { parseAgentStreamChunk } from "#src/utils/agent-stream-chunk.ts";

/** Map AI SDK agent stream chunks onto report AI editor stream events. */
export async function emitReportAgentStreamChunk(
  rawChunk: unknown,
  emit: (event: ReportAiStreamEvent) => void | Promise<void>,
): Promise<void> {
  const chunk = parseAgentStreamChunk(rawChunk);
  if (chunk === null) {
    return;
  }
  switch (chunk.kind) {
    case "step-start": {
      await emit({
        type: "step_started",
        message: "The agent started a query editing step.",
      });
      break;
    }
    case "text-delta": {
      // The report editor deliberately shows the raw model output in a
      // monospace scratch box, so text deltas are exactly what it wants. This
      // agent's tool loop runs without an `output:` spec — the draft is
      // finalized separately by generateValidatedObject once the loop ends —
      // so a delta here is the model's own text, not JSON being assembled.
      await emit({ type: "draft_delta", text: chunk.text });
      break;
    }
    case "tool-call": {
      await emit({
        type: "tool_call",
        toolName: chunk.toolName,
        message: toolCallMessage(chunk.toolName),
      });
      break;
    }
    case "tool-result": {
      await emit({
        type: "tool_result",
        toolName: chunk.toolName,
        ok: chunk.ok,
        message: toolResultMessage(chunk.toolName, chunk.ok),
      });
      break;
    }
    case "tool-error": {
      await emit({
        type: "tool_result",
        toolName: chunk.toolName,
        ok: false,
        message: `Tool failed: ${chunk.message}`,
      });
      break;
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

function toolResultMessage(toolName: string, ok: boolean): string {
  if (!ok) {
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
