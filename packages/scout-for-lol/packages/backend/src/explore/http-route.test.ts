import { describe, expect, test } from "bun:test";
import { createSseWriter } from "#src/explore/http-route.ts";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  ExploreAnswerSchema,
} from "@scout-for-lol/data";
import { clampAnswer } from "#src/explore/run-turn.ts";

/**
 * A stopped turn is the one answer path that does not go through
 * `ExploreAnswerSchema` before being written, so the cap has to be applied by
 * hand. The assertion that matters is that the result would satisfy the schema
 * every other answer is held to.
 */
describe("clampAnswer", () => {
  test("leaves an ordinary answer alone apart from trimming", () => {
    expect(clampAnswer("  Jinx leads.  ")).toBe("Jinx leads.");
  });

  test("keeps an answer exactly at the limit", () => {
    const exact = "x".repeat(EXPLORE_ANSWER_MAX_LENGTH);
    expect(clampAnswer(exact)).toBe(exact);
  });

  test("truncates past the limit and stays schema-valid", () => {
    const clamped = clampAnswer("x".repeat(EXPLORE_ANSWER_MAX_LENGTH * 3));

    expect(clamped.length).toBe(EXPLORE_ANSWER_MAX_LENGTH);
    expect(clamped.endsWith("…")).toBe(true);
    // The real contract: what every other answer is validated against.
    expect(
      ExploreAnswerSchema.parse({
        answer: clamped,
        queryText: null,
        caveats: [],
        followUps: [],
      }).answer,
    ).toBe(clamped);
  });
});

/** Mirrors the runtime: writing to a closed controller throws. */
function fakeController() {
  const chunks: string[] = [];
  let closed = false;
  const decoder = new TextDecoder();
  return {
    chunks,
    isClosed: () => closed,
    enqueue(chunk: Uint8Array) {
      if (closed) {
        throw new TypeError("Invalid state: Controller is already closed");
      }
      chunks.push(decoder.decode(chunk));
    },
    close() {
      if (closed) {
        throw new TypeError("Invalid state: Controller is already closed");
      }
      closed = true;
    },
  };
}

/**
 * The write end of a turn's SSE response.
 *
 * The bug this pins: a client that navigates away, closes the tab, or switches
 * conversations mid-turn leaves the runtime to close the controller, and the
 * teardown then wrote into it. `enqueue` throws synchronously there, and the
 * run is a voided async IIFE, so it escaped as an unhandled promise rejection
 * on an entirely ordinary user action.
 */
describe("createSseWriter", () => {
  test("writes events as SSE frames", () => {
    const controller = fakeController();
    createSseWriter(controller).emit({ type: "done" });

    expect(controller.chunks).toEqual([
      'event: done\ndata: {"type":"done"}\n\n',
    ]);
  });

  test("a disconnected client silently drops later events", () => {
    const controller = fakeController();
    const writer = createSseWriter(controller);

    // What the runtime does when the client goes away, then what the run's
    // teardown does immediately afterwards.
    controller.close();
    writer.disconnected();

    expect(() => {
      writer.emit({ type: "done" });
    }).not.toThrow();
    expect(controller.chunks).toEqual([]);
  });

  test("a disconnected client is not closed a second time", () => {
    const controller = fakeController();
    const writer = createSseWriter(controller);
    controller.close();
    writer.disconnected();

    expect(() => {
      writer.finish({ type: "done" });
    }).not.toThrow();
  });

  test("finishing closes the stream and refuses further writes", () => {
    const controller = fakeController();
    const writer = createSseWriter(controller);

    writer.finish({ type: "done" });
    writer.emit({ type: "done" });

    expect(controller.isClosed()).toBe(true);
    expect(controller.chunks).toHaveLength(1);
  });
});
