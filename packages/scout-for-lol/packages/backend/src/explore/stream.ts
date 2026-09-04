import { z } from "zod";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_TRACE_PAYLOAD_MAX_BYTES,
  EXPLORE_TRACE_TOTAL_MAX_BYTES,
  type ExploreStreamEvent,
  type ExploreTraceRawValue,
} from "@scout-for-lol/data";
import { parseAgentStreamChunk } from "#src/utils/agent-stream-chunk.ts";
import { createLogger } from "#src/logger.ts";
import {
  inspectExploreToolCall,
  inspectExploreToolResult,
} from "#src/explore/tool-inspection.ts";

const logger = createLogger("explore-stream");
type JsonValue = z.infer<ReturnType<typeof z.json>>;

/**
 * Tracks how much of the answer has already been sent to the client.
 *
 * `partialOutputStream` emits whole snapshots of the structured output rather
 * than deltas, so turning them into an append-only stream means remembering
 * the high-water mark. One of these per turn, shared by both stream readers.
 */
export type ExploreStreamState = {
  sentAnswerLength: number;
  rawTraceBytes: number;
  toolStartedAt: Map<string, number>;
  now: () => number;
};

export function createExploreStreamState(
  now: () => number = Date.now,
): ExploreStreamState {
  return {
    sentAnswerLength: 0,
    rawTraceBytes: 0,
    toolStartedAt: new Map(),
    now,
  };
}

export type ExploreAgentStreams = {
  stream: AsyncIterable<unknown>;
  partialOutputStream: AsyncIterable<unknown>;
};

/**
 * Drain both views of one AI SDK agent run concurrently and to completion.
 * They share the underlying producer, so consuming only one can stall both.
 */
export async function drainExploreStreams(
  streams: ExploreAgentStreams,
  emit: (event: ExploreStreamEvent) => void | Promise<void>,
): Promise<ExploreStreamState> {
  const streamState = createExploreStreamState();
  await Promise.all([
    (async () => {
      for await (const chunk of streams.stream) {
        await emitExploreStreamChunk(chunk, emit, streamState);
      }
    })(),
    (async () => {
      for await (const snapshot of streams.partialOutputStream) {
        await emitExploreAnswerSnapshot(snapshot, emit, streamState);
      }
    })(),
  ]);
  return streamState;
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
  const answer = (parsed.data.answer ?? "").slice(0, EXPLORE_ANSWER_MAX_LENGTH);
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
      // page. The prose arrives as snapshots on the AI SDK's separate
      // `partialOutputStream`, handled by emitExploreAnswerSnapshot.
      break;
    }
    case "tool-call": {
      const inspection = inspectExploreToolCall(chunk.toolName, chunk.input);
      state.toolStartedAt.set(chunk.toolCallId, state.now());
      await emit({
        type: "tool_call",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        message: toolCallMessage(chunk.toolName),
        details: inspection.details,
        rawInput: boundedRawValue(inspection.rawInput, state),
      });
      break;
    }
    case "tool-result": {
      const inspection = inspectExploreToolResult(
        chunk.toolName,
        chunk.input,
        chunk.output,
      );
      await emit({
        type: "tool_result",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        status: inspection.succeeded ? "succeeded" : "failed",
        message: toolResultMessage(chunk.toolName, inspection.succeeded),
        durationMs: finishToolDuration(chunk.toolCallId, state),
        details: inspection.details,
        rawOutput: boundedRawValue(inspection.rawOutput, state),
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
      });
      await emit({
        type: "tool_result",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        status: "failed",
        message: toolResultMessage(chunk.toolName, false),
        durationMs: finishToolDuration(chunk.toolCallId, state),
        details: inspectExploreToolCall(chunk.toolName, chunk.input).details,
        rawOutput: null,
      });
      break;
    }
  }
}

function finishToolDuration(
  toolCallId: string,
  state: ExploreStreamState,
): number | null {
  const startedAt = state.toolStartedAt.get(toolCallId);
  state.toolStartedAt.delete(toolCallId);
  return startedAt === undefined ? null : Math.max(0, state.now() - startedAt);
}

function boundedRawValue(
  value: JsonValue | null,
  state: ExploreStreamState,
): ExploreTraceRawValue | null {
  if (value === null) {
    return null;
  }
  const byteLength = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (byteLength > EXPLORE_TRACE_PAYLOAD_MAX_BYTES) {
    return { kind: "omitted", reason: "payload_limit", byteLength };
  }
  if (state.rawTraceBytes + byteLength > EXPLORE_TRACE_TOTAL_MAX_BYTES) {
    return { kind: "omitted", reason: "turn_limit", byteLength };
  }
  state.rawTraceBytes += byteLength;
  return { kind: "value", value, byteLength };
}

const DARE_TOOL_CALL_MESSAGES = new Map([
  ["get_dare_language", "Reading Dare contract rules."],
  ["validate_dare_contract", "Checking the dare contract."],
  ["validate_dare_scoutql", "Compiling the Dare SQL contract."],
  ["preview_dare_contract", "Backtesting the dare contract."],
  ["create_dare_draft", "Saving the dare draft."],
  ["revise_dare_draft", "Saving a draft revision."],
  ["list_dares", "Loading visible dares."],
  ["inspect_dare", "Loading the dare contract."],
  ["prepare_dare_action", "Preparing a confirmation."],
  ["delete_dare_draft", "Deleting the dare draft."],
]);

const DARE_RESULT_TOOL_NAMES = new Set(DARE_TOOL_CALL_MESSAGES.keys());

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
  if (toolName === "resolve_player") {
    return "Looking up who that is.";
  }
  if (toolName === "get_bucks_dataset") {
    return "Reading the Bryan Bucks dataset.";
  }
  if (
    toolName === "query_bucks_accounts" ||
    toolName === "query_bucks_ledger" ||
    toolName === "query_bucks_bets"
  ) {
    return "Querying Bryan Bucks records.";
  }
  const dareMessage = DARE_TOOL_CALL_MESSAGES.get(toolName);
  if (dareMessage !== undefined) return dareMessage;
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
  // Deliberately says nothing about who was found. This string is persisted
  // into the message trace and rendered verbatim, including to anonymous
  // holders of a share link.
  if (toolName === "resolve_player") {
    return "Identified the player.";
  }
  if (
    toolName === "get_bucks_dataset" ||
    toolName === "query_bucks_accounts" ||
    toolName === "query_bucks_ledger" ||
    toolName === "query_bucks_bets"
  ) {
    return "Got Bryan Bucks results.";
  }
  if (DARE_RESULT_TOOL_NAMES.has(toolName)) {
    return "Dare action completed.";
  }
  return `${toolName} completed.`;
}
