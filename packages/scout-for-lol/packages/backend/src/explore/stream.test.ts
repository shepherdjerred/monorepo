import { describe, expect, test } from "bun:test";
import {
  ExploreAnswerSchema,
  ExploreStreamEventSchema,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import {
  createExploreStreamState,
  emitExploreStreamChunk,
} from "#src/explore/stream.ts";

/**
 * The explore agent runs with structured output, so the model emits JSON and
 * Mastra hands back progressively-repaired snapshots of it. Prose reaches the
 * page from those snapshots, never from the raw text deltas.
 *
 * Both properties below fail *silently* if broken — the turn still succeeds,
 * the answer just arrives wrong or all at once — so they are pinned here.
 */

async function collect(
  chunks: unknown[],
): Promise<{ events: ExploreStreamEvent[]; text: string }> {
  const events: ExploreStreamEvent[] = [];
  const state = createExploreStreamState();
  for (const chunk of chunks) {
    await emitExploreStreamChunk(
      chunk,
      (event) => {
        events.push(event);
      },
      state,
    );
  }
  const text = events
    .map((event) => (event.type === "answer_delta" ? event.text : ""))
    .join("");
  return { events, text };
}

function objectChunk(answer: string): unknown {
  return { type: "object", object: { answer } };
}

describe("explore stream mapping", () => {
  test("`answer` is the first field of the answer schema", () => {
    // Mastra's partial snapshots only contain the keys the model has emitted
    // so far. If `answer` stops being first, nothing streams until every
    // earlier field is complete — the page would sit blank and then paste the
    // whole answer at once, with no error anywhere.
    expect(Object.keys(ExploreAnswerSchema.shape)[0]).toBe("answer");
  });

  test("object snapshots stream as monotonic appends", async () => {
    const { text, events } = await collect([
      objectChunk("Across"),
      objectChunk("Across the bottom"),
      objectChunk("Across the bottom lane"),
    ]);

    expect(text).toBe("Across the bottom lane");
    expect(
      events
        .filter((event) => event.type === "answer_delta")
        .map((event) => (event.type === "answer_delta" ? event.text : "")),
    ).toEqual(["Across", " the bottom", " lane"]);
  });

  test("a repeated snapshot emits nothing", async () => {
    const { events } = await collect([
      objectChunk("Jinx leads."),
      objectChunk("Jinx leads."),
    ]);
    expect(
      events.filter((event) => event.type === "answer_delta"),
    ).toHaveLength(1);
  });

  test("a snapshot without `answer` yet emits nothing", async () => {
    const { events } = await collect([
      { type: "object", object: {} },
      { type: "object", object: { queryText: "SELECT champion FROM x" } },
    ]);
    expect(events).toHaveLength(0);
  });

  test("raw text deltas never reach the page", async () => {
    // This is the bug this test exists to prevent: with structured output a
    // text delta is a fragment of raw JSON, so relaying it would stream
    // `{"answer":"Across…` into the transcript.
    const { events } = await collect([
      { type: "text-delta", payload: { text: '{"answer":"Across' } },
      { type: "text-delta", payload: { text: ' the bottom lane"' } },
    ]);
    expect(events).toHaveLength(0);
  });

  test("tool activity still surfaces alongside the answer", async () => {
    const { events } = await collect([
      { type: "tool-call", payload: { toolName: "run_report_query" } },
      { type: "tool-result", payload: { toolName: "run_report_query" } },
      objectChunk("Jinx leads."),
    ]);

    expect(events.map((event) => event.type)).toEqual([
      "tool_call",
      "tool_result",
      "answer_delta",
    ]);
  });

  /**
   * A tool exception is unbounded (stack traces, SQL errors), the event field
   * is capped at 500 chars, and `emit` validates against that schema — so
   * forwarding the raw text would throw mid-turn and take the whole stream
   * down. The same string is persisted into the trace and rendered to
   * anonymous share-link holders, so it must not carry internals either.
   */
  test("a tool error is reported without forwarding the raw exception", async () => {
    const rawError = `Boom: ${"x".repeat(4000)}\nat someInternalFrame`;
    const { events } = await collect([
      {
        type: "tool-error",
        payload: { toolName: "run_report_query", error: rawError },
      },
    ]);

    expect(events).toHaveLength(1);
    const [event] = events;
    if (event?.type !== "tool_result") {
      throw new Error("expected a tool_result event");
    }
    expect(event.ok).toBe(false);
    expect(event.message.length).toBeLessThanOrEqual(500);
    expect(event.message).not.toContain("someInternalFrame");
    expect(event.message).not.toContain("xxxx");
    // The schema is what would have thrown, so parsing is the real assertion.
    expect(ExploreStreamEventSchema.parse(event)).toEqual(event);
  });

  test("a stream error chunk throws rather than ending the turn quietly", () => {
    const state = createExploreStreamState();
    expect(
      emitExploreStreamChunk(
        { type: "error", payload: { error: new Error("upstream exploded") } },
        () => {
          // discarded: this test only cares that the chunk throws
        },
        state,
      ),
    ).rejects.toThrow(/upstream exploded/);
  });
});
