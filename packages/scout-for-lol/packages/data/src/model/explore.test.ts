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

  test("skips a member this bundle has never heard of", () => {
    // A browser keeps its bundle for as long as the tab stays open, so a
    // deploy that adds a stream event reaches parsers that predate it. The
    // SSE reader treats a throw as a corrupted stream, so without this an
    // open tab would die mid-turn on a turn the server answered correctly.
    expect(
      parseExploreStreamEvent({ type: "activity", text: "Finding a player…" }),
    ).toBeNull();
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
