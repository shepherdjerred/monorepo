import { describe, expect, test } from "vitest";
import {
  ExploreTraceEntrySchema,
  parseExploreStreamEvent,
} from "#src/model/explore.ts";

describe("ExploreTraceEntrySchema", () => {
  test("normalizes a stored legacy trace entry", () => {
    expect(
      ExploreTraceEntrySchema.parse({
        toolName: "run_report_query",
        message: "Got results.",
        ok: true,
      }),
    ).toEqual({
      toolCallId: "legacy-run_report_query",
      toolName: "run_report_query",
      message: "Got results.",
      status: "succeeded",
      durationMs: null,
      details: null,
      rawInput: null,
      rawOutput: null,
    });
  });
});

describe("parseExploreStreamEvent", () => {
  test("parses a known event", () => {
    const event = parseExploreStreamEvent({
      type: "answer_delta",
      text: "Jinx ",
    });
    expect(event).toEqual({ type: "answer_delta", text: "Jinx " });
  });

  test("skips an unknown member that marked itself ignorable", () => {
    // A browser keeps its bundle for as long as the tab stays open, so a
    // deploy that adds a stream event reaches parsers that predate it. The
    // SSE reader treats a throw as a corrupted stream, so without this an
    // open tab would die mid-turn on a turn the server answered correctly.
    expect(
      parseExploreStreamEvent({
        type: "a-member-from-a-newer-server",
        ignorable: true,
        whatever: true,
      }),
    ).toBeNull();
  });

  test("refuses an unknown member that did not volunteer to be skipped", () => {
    // Tolerance is granted by the sender, not assumed by the reader. An
    // unknown discriminator proves the server is newer; it does not prove
    // that what it sent was unimportant. Dropping an event the transcript
    // depended on would leave the page quietly wrong rather than visibly
    // broken, so this takes the corrupted-stream path, which reconnects.
    expect(() =>
      parseExploreStreamEvent({ type: "a-member-this-client-needs" }),
    ).toThrow();
    expect(() =>
      parseExploreStreamEvent({
        type: "a-member-this-client-needs",
        ignorable: false,
      }),
    ).toThrow();
  });

  test("still throws on a known type carrying the wrong shape", () => {
    // The tolerance is only for unrecognised discriminators. The server
    // validates every event before emitting it, so a known type in the wrong
    // shape is real corruption and must not be swallowed.
    expect(() =>
      parseExploreStreamEvent({ type: "answer_delta", text: 42 }),
    ).toThrow();
  });

  test("still throws on a frame that is not an event at all", () => {
    expect(() => parseExploreStreamEvent("not an object")).toThrow();
    expect(() => parseExploreStreamEvent({ nope: true })).toThrow();
  });
});
