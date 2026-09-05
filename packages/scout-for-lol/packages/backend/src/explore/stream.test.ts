import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  EXPLORE_ACTIVITY_MAX_LENGTH,
  EXPLORE_ANSWER_MAX_LENGTH,
  EXPLORE_TITLE_MAX_LENGTH,
  ExploreAnswerSchema,
  ExploreAnswerWireSchema,
  ExploreStreamEventSchema,
  type ExploreStreamEvent,
} from "@scout-for-lol/data";
import {
  createExploreStreamState,
  drainExploreStreams,
  emitExploreAnswerSnapshot,
  emitExploreStreamChunk,
} from "#src/explore/stream.ts";

/**
 * The explore agent runs with an `output:` spec, so the model emits JSON and
 * the AI SDK hands back progressively-parsed snapshots of it on a separate
 * `partialOutputStream`. Prose reaches the page from those snapshots, never
 * from the raw text deltas on the wire stream.
 *
 * Both properties below fail *silently* if broken — the turn still succeeds,
 * the answer just arrives wrong or all at once — so they are pinned here.
 *
 * Fixtures below are hand-written wire shapes. They pin this module's mapping,
 * not the SDK's actual part shapes, so a dialect drift upstream still needs a
 * live run to catch.
 */

/** Test-local marker routing a fixture to the snapshot path. */
const SnapshotFixtureSchema = z.looseObject({
  type: z.literal("object"),
  object: z.unknown(),
});

async function collect(
  chunks: unknown[],
): Promise<{ events: ExploreStreamEvent[]; text: string }> {
  const events: ExploreStreamEvent[] = [];
  const state = createExploreStreamState();
  const push = (event: ExploreStreamEvent) => {
    events.push(event);
  };
  for (const chunk of chunks) {
    const snapshot = SnapshotFixtureSchema.safeParse(chunk);
    if (snapshot.success) {
      await emitExploreAnswerSnapshot(snapshot.data.object, push, state);
    } else {
      await emitExploreStreamChunk(chunk, push, state);
    }
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
    // Partial snapshots only contain the keys the model has emitted
    // so far. If `answer` stops being first, nothing streams until every
    // earlier field is complete — the page would sit blank and then paste the
    // whole answer at once, with no error anywhere.
    expect(Object.keys(ExploreAnswerSchema.shape)[0]).toBe("answer");
  });

  test("the strict wire schema carries the generated conversation title", () => {
    const parsed = ExploreAnswerSchema.parse(
      ExploreAnswerWireSchema.parse({
        answer: "Ambessa leads.",
        title: "Champion win-rate leaders",
        queryText: null,
        caveats: [],
        followUps: [],
      }),
    );

    expect(Object.keys(ExploreAnswerWireSchema.shape)[0]).toBe("answer");
    expect(parsed.title).toBe("Champion win-rate leaders");
  });

  test("an over-long title does not fail the whole answer", () => {
    // The same schema instructs the model and parses its output, so a `max()`
    // on `title` turned a too-long title into a parse failure — sending the
    // turn down the error/salvage path and dropping preview/visualization
    // alongside an answer that was otherwise fine. The bound belongs at the
    // display/storage boundary (`titleFromQuestion`), not here.
    const parsed = ExploreAnswerSchema.parse({
      answer: "Jinx leads.",
      title: "t".repeat(EXPLORE_TITLE_MAX_LENGTH * 3),
      queryText: null,
      caveats: [],
      followUps: [],
    });

    expect(parsed.title).toBe("t".repeat(EXPLORE_TITLE_MAX_LENGTH * 3));
    expect(parsed.answer).toBe("Jinx leads.");
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

  test("partial snapshots stop at the persisted answer limit", async () => {
    const prefix = "x".repeat(EXPLORE_ANSWER_MAX_LENGTH - 1);
    const { events, text } = await collect([
      objectChunk(prefix),
      objectChunk(`${prefix}y${"z".repeat(100)}`),
      objectChunk(`${prefix}y${"z".repeat(200)}`),
    ]);

    expect(text).toBe(`${prefix}y`);
    expect(text).toHaveLength(EXPLORE_ANSWER_MAX_LENGTH);
    expect(
      events.filter((event) => event.type === "answer_delta"),
    ).toHaveLength(2);
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
      { type: "text-delta", text: '{"answer":"Across' },
      { type: "text-delta", text: ' the bottom lane"' },
    ]);
    expect(events.filter((event) => event.type === "answer_delta")).toEqual([]);
    // Their arrival is still information — with no tool in flight the first
    // one is the moment the model started composing — but it is announced
    // once per turn, not once per fragment.
    expect(events.filter((event) => event.type === "activity")).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "activity",
      text: "Writing the answer…",
    });
  });

  test("tool activity still surfaces alongside the answer", async () => {
    const { events } = await collect([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText: "FROM matches SELECT games" },
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText: "FROM matches SELECT games" },
        output: {
          ok: true,
          message: "Returned 1 row.",
          formattedQueryText: "FROM matches SELECT games",
          preview: null,
        },
      },
      objectChunk("Jinx leads."),
    ]);

    // This is the test that pins the bracket ordering: the call is narrated
    // before the step appears, and the outcome only after the step has
    // flipped to its final status, so the status line and the step panel can
    // never disagree about what is happening.
    expect(events.map((event) => event.type)).toEqual([
      "activity",
      "tool_call",
      "tool_result",
      "activity",
      "answer_delta",
    ]);
  });
});

describe("explore tool stream inspection", () => {
  test("records tool duration using the provider call id", async () => {
    let now = 1000;
    const state = createExploreStreamState(() => now);
    const events: ExploreStreamEvent[] = [];
    await emitExploreStreamChunk(
      {
        type: "tool-call",
        toolCallId: "duration-call",
        toolName: "format_report_query",
        input: { queryText: "FROM matches SELECT games" },
      },
      (event) => {
        events.push(event);
      },
      state,
    );
    now = 1275;
    await emitExploreStreamChunk(
      {
        type: "tool-result",
        toolCallId: "duration-call",
        toolName: "format_report_query",
        input: { queryText: "FROM matches SELECT games" },
        output: { formattedQueryText: "FROM matches SELECT games" },
      },
      (event) => {
        events.push(event);
      },
      state,
    );

    const result = events.find((event) => event.type === "tool_result");
    expect(result?.durationMs).toBe(275);
  });

  test("a rejected query is reported as a failed tool result", async () => {
    const { events } = await collect([
      {
        type: "tool-call",
        toolCallId: "rejected-call",
        toolName: "run_report_query",
        input: { queryText: "FROM matches SELECT nope" },
      },
      {
        type: "tool-result",
        toolCallId: "rejected-call",
        toolName: "run_report_query",
        input: { queryText: "FROM matches SELECT nope" },
        output: {
          ok: false,
          message: "Invalid query.",
          formattedQueryText: null,
          preview: null,
        },
      },
    ]);

    const result = events.find((event) => event.type === "tool_result");
    expect(result?.status).toBe("failed");
    expect(result?.details).toMatchObject({
      kind: "execution",
      ok: false,
    });
  });
});

describe("explore raw tool payload inspection", () => {
  test("omits one raw payload above the per-payload inspection limit", async () => {
    const { events } = await collect([
      {
        type: "tool-call",
        toolCallId: "call-large",
        toolName: "validate_report_query",
        input: { queryText: "FROM matches SELECT games" },
      },
      {
        type: "tool-result",
        toolCallId: "call-large",
        toolName: "validate_report_query",
        input: { queryText: "FROM matches SELECT games" },
        output: {
          ok: false,
          message: "Invalid query.",
          diagnostics: [
            {
              code: "parse-error",
              severity: "error",
              message: "x".repeat(70_000),
              span: { start: 0, end: 1 },
              fixes: [],
            },
          ],
          formattedQueryText: null,
        },
      },
    ]);
    const result = events.find((event) => event.type === "tool_result");
    expect(result?.status).toBe("failed");
    expect(result?.rawOutput).toMatchObject({
      kind: "omitted",
      reason: "payload_limit",
    });
    expect(result?.details?.kind).toBe("validation");
    if (result?.details?.kind === "validation") {
      expect(result.details.diagnostics[0]?.length).toBeLessThanOrEqual(500);
    }
  });

  test("enforces the aggregate raw inspection limit across a turn", async () => {
    const chunks = Array.from({ length: 5 }, (_, index) => {
      const toolCallId = `call-${index.toString()}`;
      const input = { queryText: "FROM matches SELECT games" };
      return [
        {
          type: "tool-call",
          toolCallId,
          toolName: "validate_report_query",
          input,
        },
        {
          type: "tool-result",
          toolCallId,
          toolName: "validate_report_query",
          input,
          output: {
            ok: false,
            message: "Invalid query.",
            diagnostics: [
              {
                code: "parse-error",
                severity: "error",
                message: "x".repeat(60_000),
                span: { start: 0, end: 1 },
                fixes: [],
              },
            ],
            formattedQueryText: null,
          },
        },
      ];
    }).flat();
    const { events } = await collect(chunks);
    const results = events.filter((event) => event.type === "tool_result");

    expect(results.at(-1)?.rawOutput).toMatchObject({
      kind: "omitted",
      reason: "turn_limit",
    });
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
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText: "FROM matches SELECT games" },
        error: rawError,
      },
    ]);

    const [event, narration] = events;
    if (event?.type !== "tool_result") {
      throw new Error("expected a tool_result event");
    }
    expect(event.status).toBe("failed");
    expect(event.message.length).toBeLessThanOrEqual(500);
    expect(event.message).not.toContain("someInternalFrame");
    expect(event.message).not.toContain("xxxx");
    // The schema is what would have thrown, so parsing is the real assertion.
    expect(ExploreStreamEventSchema.parse(event)).toEqual(event);

    // The status line is a second place the exception could have escaped to,
    // and it has a tighter cap than the trace message, so it would fail the
    // schema sooner rather than later.
    if (narration?.type !== "activity") {
      throw new Error("expected the failure to be narrated");
    }
    expect(narration.text.length).toBeLessThanOrEqual(
      EXPLORE_ACTIVITY_MAX_LENGTH,
    );
    expect(narration.text).not.toContain("someInternalFrame");
    expect(narration.text).not.toContain("xxxx");
    expect(ExploreStreamEventSchema.parse(narration)).toEqual(narration);
  });

  test("drains both agent streams concurrently to completion", async () => {
    let streamStarted = false;
    let partialOutputStreamStarted = false;
    let streamCompleted = false;
    let partialOutputStreamCompleted = false;
    let resolveStreamStarted: (() => void) | undefined;
    let resolvePartialOutputStreamStarted: (() => void) | undefined;
    const streamStartedPromise = new Promise<void>((resolve) => {
      resolveStreamStarted = resolve;
    });
    const partialOutputStreamStartedPromise = new Promise<void>((resolve) => {
      resolvePartialOutputStreamStarted = resolve;
    });

    async function* stream(): AsyncGenerator {
      streamStarted = true;
      resolveStreamStarted?.();
      await partialOutputStreamStartedPromise;
      yield { type: "not-a-real-stream-part" };
      streamCompleted = true;
    }

    async function* partialOutputStream(): AsyncGenerator {
      partialOutputStreamStarted = true;
      resolvePartialOutputStreamStarted?.();
      await streamStartedPromise;
      yield { answer: "Jinx leads." };
      partialOutputStreamCompleted = true;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        drainExploreStreams(
          { stream: stream(), partialOutputStream: partialOutputStream() },
          () => Promise.resolve(),
        ),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error("stream drain did not run concurrently")),
            1000,
          );
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    expect(streamStarted).toBe(true);
    expect(partialOutputStreamStarted).toBe(true);
    expect(streamCompleted).toBe(true);
    expect(partialOutputStreamCompleted).toBe(true);
  });

  test("a stream error chunk throws rather than ending the turn quietly", async () => {
    await expect(
      emitExploreStreamChunk(
        { type: "error", error: new Error("upstream exploded") },
        () => {
          // discarded: this test only cares that the chunk throws
        },
        createExploreStreamState(),
      ),
    ).rejects.toThrow(/upstream exploded/);
  });
});

/**
 * The live status line and the persisted trace are two channels with two
 * audiences. A trace `message` is stored on the message and served
 * unauthenticated to anyone holding a share link; an `activity` string is
 * never stored and never shared. That asymmetry is what lets the status line
 * be specific, and these tests are what keep the two from swapping places.
 */
function narrations(events: ExploreStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "activity" ? [event.text] : [],
  );
}

function traceMessages(events: ExploreStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === "tool_call" || event.type === "tool_result"
      ? [event.message]
      : [],
  );
}

describe("explore live status versus persisted trace", () => {
  test("the status line names the player while the trace stays anonymous", async () => {
    const { events } = await collect([
      {
        type: "tool-input-start",
        id: "call-1",
        toolName: "resolve_player",
      },
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "resolve_player",
        input: { query: "Jerred#NA1" },
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "resolve_player",
        input: { query: "Jerred#NA1" },
        output: { candidates: [{ displayName: "Jerred" }], message: "One." },
      },
    ]);

    expect(narrations(events).join(" ")).toContain("Jerred#NA1");
    // The pair of assertions below is the entire design in one place.
    for (const message of traceMessages(events)) {
      expect(message).not.toContain("Jerred");
    }
    expect(traceMessages(events)).toEqual([
      "Looking up who that is.",
      "Identified the player.",
    ]);
  });

  test("no part of a query reaches the status line", async () => {
    // The source name is looked up in the closed catalog and the catalog's own
    // id is what gets emitted, so a query cannot smuggle text onto the wire
    // through the table it names.
    const queryText =
      "FROM match_participants SELECT games WHERE player('secret-alias')";
    const { events } = await collect([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText },
      },
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText },
        output: {
          ok: true,
          message: "Returned 84 rows.",
          formattedQueryText: queryText,
          preview: {
            columns: [{ key: "label", label: "Player", format: "text" }],
            rows: [{ label: "Jinx", values: [] }],
            rowsReturned: 84,
            rowsScanned: 1_284_000,
            renderKind: "TABLE",
          },
        },
      },
    ]);

    const text = narrations(events).join(" ");
    expect(text).not.toContain("secret-alias");
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("WHERE");
    // The high-information half comes from numbers the engine computed.
    expect(text).toContain("Querying match participants");
    expect(text).toContain("Scanned 1.3M rows, kept 84");
  });

  test("an unknown source falls back to the generic phrase", async () => {
    const { events } = await collect([
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText: "FROM notasource SELECT x" },
      },
    ]);
    const text = narrations(events).join(" ");
    expect(text).not.toContain("notasource");
    expect(text).toBe("Querying match data.");
  });

  test("tool-input-start narrates early without starting the duration clock", async () => {
    let now = 1000;
    const state = createExploreStreamState(() => now);
    const events: ExploreStreamEvent[] = [];
    const push = (event: ExploreStreamEvent) => {
      events.push(event);
    };
    await emitExploreStreamChunk(
      { type: "tool-input-start", id: "call-1", toolName: "run_report_query" },
      push,
      state,
    );
    // Only a status line so far — no step exists until its arguments do.
    expect(events.map((event) => event.type)).toEqual(["activity"]);

    now = 2000;
    await emitExploreStreamChunk(
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText: "FROM match_participants SELECT games" },
      },
      push,
      state,
    );
    now = 2275;
    await emitExploreStreamChunk(
      {
        type: "tool-result",
        toolCallId: "call-1",
        toolName: "run_report_query",
        input: { queryText: "FROM match_participants SELECT games" },
        output: {
          ok: true,
          message: "Returned 1 row.",
          formattedQueryText: "FROM match_participants SELECT games",
          preview: null,
        },
      },
      push,
      state,
    );

    // 275ms, not 1275: the clock starts when the tool runs, not when the
    // model began writing its arguments. Timing it from input-start would
    // silently redefine what the trace's `durationMs` means.
    const result = events.find((event) => event.type === "tool_result");
    expect(result?.durationMs).toBe(275);
  });

  test("a malformed tool input still narrates before the inspection throws", async () => {
    const state = createExploreStreamState();
    const events: ExploreStreamEvent[] = [];
    await expect(
      emitExploreStreamChunk(
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "run_report_query",
          input: { queryText: 42 },
        },
        (event) => {
          events.push(event);
        },
        state,
      ),
    ).rejects.toThrow();
    // Status text is decoration: it degrades to the generic phrase rather
    // than escalating, and it is emitted before the strict parse that throws.
    expect(events).toEqual([
      { type: "activity", text: "Querying match data.", toolCallId: "call-1" },
    ]);
  });
});
