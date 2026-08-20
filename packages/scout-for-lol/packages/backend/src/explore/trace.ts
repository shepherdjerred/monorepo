import {
  ExploreTraceEntrySchema,
  ExploreTranscriptSchema,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
  type ExploreTranscript,
} from "@scout-for-lol/data";

/** Fold one tool stream event into its stable, provider-id-keyed timeline. */
export function recordExploreTraceEvent(
  trace: ExploreTraceEntry[],
  event: ExploreStreamEvent,
): void {
  if (event.type === "tool_call") {
    trace.push(
      ExploreTraceEntrySchema.parse({
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        message: event.message,
        status: "running",
        durationMs: null,
        details: event.details,
        rawInput: event.rawInput,
        rawOutput: null,
      }),
    );
    return;
  }
  if (event.type !== "tool_result") {
    return;
  }
  const index = trace.findIndex(
    (entry) => entry.toolCallId === event.toolCallId,
  );
  const existing = index === -1 ? null : trace[index];
  const completed = ExploreTraceEntrySchema.parse({
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    message: event.message,
    status: event.status,
    durationMs: event.durationMs,
    details: event.details,
    rawInput: existing?.rawInput ?? null,
    rawOutput: event.rawOutput,
  });
  if (index === -1) {
    trace.push(completed);
  } else {
    trace[index] = completed;
  }
}

/** A provider call with no terminal part is evidence of an interrupted step. */
export function finalizeExploreTrace(
  trace: ExploreTraceEntry[],
): ExploreTraceEntry[] {
  return trace.map((entry) =>
    entry.status === "running"
      ? ExploreTraceEntrySchema.parse({
          ...entry,
          status: "interrupted",
          message: "Interrupted before this step finished.",
        })
      : entry,
  );
}

/** Remove owner-only payloads before an anonymous shared response is encoded. */
export function redactSharedExploreTranscript(
  transcript: ExploreTranscript,
): ExploreTranscript {
  return ExploreTranscriptSchema.parse({
    conversation: transcript.conversation,
    messages: transcript.messages.map((message) => ({
      ...message,
      trace: message.trace.map((entry) => ({
        ...entry,
        rawInput: null,
        rawOutput: null,
      })),
    })),
  });
}
