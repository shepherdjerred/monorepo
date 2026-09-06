import { describe, expect, test } from "vitest";
import { parseAgentStreamChunk } from "#src/utils/agent-stream-chunk.ts";

describe("parseAgentStreamChunk", () => {
  test("renames tool-input-start's `id` to a call id", () => {
    // The AI SDK carries two dialects of this part. `agent.stream().stream`
    // yields `TextStreamPart`, where the field is `id`; the `toolCallId`
    // spelling belongs to the UI-message chunk union, which Explore does not
    // consume. Matching on the wrong one produces a member that silently
    // never fires, because unparsed chunks are dropped by design — so this
    // test is the only thing standing between that and an invisible bug.
    expect(
      parseAgentStreamChunk({
        type: "tool-input-start",
        id: "call-1",
        toolName: "run_report_query",
      }),
    ).toEqual({
      kind: "tool-input-start",
      toolCallId: "call-1",
      toolName: "run_report_query",
    });
  });

  test("ignores the chunk kinds this parser deliberately does not read", () => {
    // Each of these is an omission with a reason, documented on the parser:
    // argument deltas would mean buffering model-authored query text, and
    // reasoning is free text that is the likeliest place for a raw query to
    // appear verbatim. A future change that starts parsing one of these
    // should have to delete a line here and say why.
    for (const chunk of [
      { type: "tool-input-delta", id: "call-1", delta: '{"queryText":"FROM' },
      { type: "tool-input-end", id: "call-1" },
      { type: "reasoning-start", id: "reason-1" },
      { type: "reasoning-delta", id: "reason-1", text: "Let me think" },
      { type: "finish-step" },
      { type: "raw", rawValue: {} },
    ]) {
      expect(parseAgentStreamChunk(chunk)).toBeNull();
    }
  });

  test("drops an unrecognised chunk rather than failing the turn", () => {
    expect(parseAgentStreamChunk({ type: "something-new" })).toBeNull();
    expect(parseAgentStreamChunk("not a chunk")).toBeNull();
  });

  test("throws only on a chunk that reports a stream error", () => {
    expect(() =>
      parseAgentStreamChunk({ type: "error", error: new Error("upstream") }),
    ).toThrow("upstream");
  });
});
