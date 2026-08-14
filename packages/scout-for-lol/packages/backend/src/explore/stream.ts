import type { ExploreStreamEvent } from "@scout-for-lol/data";
import { parseAgentStreamChunk } from "#src/utils/agent-stream-chunk.ts";

/** Map Mastra agent stream chunks onto explore stream events. */
export async function emitExploreStreamChunk(
  rawChunk: unknown,
  emit: (event: ExploreStreamEvent) => void | Promise<void>,
): Promise<void> {
  const chunk = parseAgentStreamChunk(rawChunk);
  if (chunk === null) {
    return;
  }
  switch (chunk.kind) {
    case "step-start": {
      // Explore shows tool activity rather than step boundaries; a bare
      // "started a step" line adds noise to a chat transcript.
      break;
    }
    case "text-delta": {
      await emit({ type: "answer_delta", text: chunk.text });
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
    return "Reading the ScoutQL reference.";
  }
  if (toolName === "validate_report_query") {
    return "Checking the query.";
  }
  if (toolName === "run_report_query") {
    return "Querying match data.";
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
  if (toolName === "run_report_query") {
    return "Got results.";
  }
  if (toolName === "validate_report_query") {
    return "Query checked.";
  }
  return `${toolName} completed.`;
}
