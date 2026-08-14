import { z } from "zod";
import type { ExploreStreamEvent } from "@scout-for-lol/data";
import { parseAgentStreamChunk } from "#src/utils/agent-stream-chunk.ts";

/**
 * Tracks how much of the answer has already been sent to the client.
 *
 * Mastra emits whole snapshots of the structured output rather than deltas, so
 * turning them into an append-only stream means remembering the high-water
 * mark. One of these per turn.
 */
export type ExploreStreamState = {
  sentAnswerLength: number;
};

export function createExploreStreamState(): ExploreStreamState {
  return { sentAnswerLength: 0 };
}

/** Only the field being streamed; the rest of the snapshot is ignored here. */
const PartialAnswerSchema = z.looseObject({ answer: z.string().optional() });

/** Map Mastra agent stream chunks onto explore stream events. */
export async function emitExploreStreamChunk(
  rawChunk: unknown,
  emit: (event: ExploreStreamEvent) => void | Promise<void>,
  state: ExploreStreamState,
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
      // Deliberately ignored. This agent runs with structured output, so a
      // text delta is a fragment of the raw JSON the model is emitting —
      // relaying it would stream `{"answer":"Across the botto…` into the
      // page. The prose arrives via `object` snapshots below.
      break;
    }
    case "object": {
      const parsed = PartialAnswerSchema.safeParse(chunk.object);
      if (!parsed.success) {
        break;
      }
      const answer = parsed.data.answer ?? "";
      if (answer.length > state.sentAnswerLength) {
        await emit({
          type: "answer_delta",
          text: answer.slice(state.sentAnswerLength),
        });
        state.sentAnswerLength = answer.length;
      }
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
