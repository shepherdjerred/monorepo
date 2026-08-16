import { z } from "zod";
import type { ExploreStreamEvent } from "@scout-for-lol/data";
import { parseAgentStreamChunk } from "#src/utils/agent-stream-chunk.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("explore-stream");

/**
 * Tracks how much of the answer has already been sent to the client.
 *
 * `partialOutputStream` emits whole snapshots of the structured output rather
 * than deltas, so turning them into an append-only stream means remembering
 * the high-water mark. One of these per turn, shared by both stream readers.
 */
export type ExploreStreamState = {
  sentAnswerLength: number;
};

export function createExploreStreamState(): ExploreStreamState {
  return { sentAnswerLength: 0 };
}

/** Only the field being streamed; the rest of the snapshot is ignored here. */
const PartialAnswerSchema = z.looseObject({ answer: z.string().optional() });

/**
 * Turn one structured-output snapshot into an append-only `answer_delta`.
 *
 * These arrive on the AI SDK's `partialOutputStream`, not on `fullStream`, so
 * they enter here rather than through emitExploreStreamChunk. A snapshot only
 * carries the keys the model has emitted so far, which is why `answer` must
 * stay the first field of ExploreAnswerSchema — a later field would not start
 * streaming until everything before it had been emitted.
 */
export async function emitExploreAnswerSnapshot(
  snapshot: unknown,
  emit: (event: ExploreStreamEvent) => void | Promise<void>,
  state: ExploreStreamState,
): Promise<void> {
  const parsed = PartialAnswerSchema.safeParse(snapshot);
  if (!parsed.success) {
    return;
  }
  const answer = parsed.data.answer ?? "";
  if (answer.length > state.sentAnswerLength) {
    await emit({
      type: "answer_delta",
      text: answer.slice(state.sentAnswerLength),
    });
    state.sentAnswerLength = answer.length;
  }
}

/** Map AI SDK agent stream chunks onto explore stream events. */
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
      // Deliberately ignored. This agent runs with structured output, so a
      // text delta is a fragment of the raw JSON the model is emitting —
      // relaying it would stream `{"answer":"Across the botto…` into the
      // page. The prose arrives as snapshots on the AI SDK's separate
      // `partialOutputStream`, handled by emitExploreAnswerSnapshot.
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
      // The raw exception text is deliberately not forwarded. It is unbounded
      // — a stack trace or a SQL error blows past the 500-char cap on this
      // field and makes ExploreStreamEventSchema.parse throw, which kills the
      // whole turn's stream. It is also persisted into the message trace and
      // rendered verbatim, including to anonymous holders of a share link, so
      // it would leak internals to people who never ran the query.
      logger.warn("Explore tool failed", {
        toolName: chunk.toolName,
        error: chunk.message,
      });
      await emit({
        type: "tool_result",
        toolName: chunk.toolName,
        ok: false,
        message: toolResultMessage(chunk.toolName, false),
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
