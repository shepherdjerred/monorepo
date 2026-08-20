import { describe, expect, test } from "bun:test";
import {
  ExploreTranscriptSchema,
  type ExploreStreamEvent,
  type ExploreTraceEntry,
} from "@scout-for-lol/data";
import {
  finalizeExploreTrace,
  recordExploreTraceEvent,
  redactSharedExploreTranscript,
} from "#src/explore/trace.ts";

const TOOL_CALL: ExploreStreamEvent = {
  type: "tool_call",
  toolCallId: "call-1",
  toolName: "run_report_query",
  message: "Querying match data.",
  details: {
    kind: "execution",
    queryText: "FROM matches SELECT games",
    ok: null,
    rowsReturned: null,
    rowsScanned: null,
    renderKind: null,
  },
  rawInput: {
    kind: "value",
    value: { queryText: "owner-only-input" },
    byteLength: 32,
  },
};

describe("Explore trace recording", () => {
  test("pairs a result with its running call and keeps the original input", () => {
    const trace: ExploreTraceEntry[] = [];
    recordExploreTraceEvent(trace, TOOL_CALL);
    recordExploreTraceEvent(trace, {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "run_report_query",
      status: "succeeded",
      message: "Got results.",
      durationMs: 125,
      details: {
        kind: "execution",
        queryText: "FROM matches SELECT games",
        ok: true,
        rowsReturned: 1,
        rowsScanned: 42,
        renderKind: "TABLE",
      },
      rawOutput: {
        kind: "value",
        value: { privateResult: "owner-only-output" },
        byteLength: 37,
      },
    });

    expect(trace).toHaveLength(1);
    expect(trace[0]?.status).toBe("succeeded");
    expect(trace[0]?.durationMs).toBe(125);
    expect(trace[0]?.rawInput?.kind).toBe("value");
    expect(trace[0]?.rawOutput?.kind).toBe("value");
  });

  test("marks a call without a terminal result as interrupted", () => {
    const trace: ExploreTraceEntry[] = [];
    recordExploreTraceEvent(trace, TOOL_CALL);
    const finalized = finalizeExploreTrace(trace);

    expect(finalized[0]?.status).toBe("interrupted");
    expect(finalized[0]?.message).toContain("Interrupted");
  });

  test("removes owner-only payloads from a shared transcript", () => {
    const trace: ExploreTraceEntry[] = [];
    recordExploreTraceEvent(trace, TOOL_CALL);
    const transcript = ExploreTranscriptSchema.parse({
      conversation: {
        id: "11111111-1111-4111-8111-111111111111",
        title: "Private tool data",
        shareToken: "a".repeat(32),
        sharedLeafId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-08-18T12:00:00.000Z",
        updatedAt: "2026-08-18T12:00:00.000Z",
      },
      messages: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          role: "assistant",
          content: "Answer",
          trace,
          createdAt: "2026-08-18T12:00:00.000Z",
        },
      ],
    });

    const publicTranscript = redactSharedExploreTranscript(transcript);
    const encoded = JSON.stringify(publicTranscript);
    expect(encoded).not.toContain("owner-only-input");
    expect(publicTranscript.messages[0]?.trace[0]?.details?.kind).toBe(
      "execution",
    );
  });
});
