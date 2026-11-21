import { describe, expect, test } from "vitest";
import {
  INITIAL_CONNECTION,
  nextConnection,
  refusalFor,
  retryDelay,
  type ConnectionEvent,
  type ConnectionState,
} from "@shepherdjerred/streambot/web/client/room/room-connection.ts";

function run(events: readonly ConnectionEvent[]): ConnectionState {
  return events.reduce(
    (state, event) => nextConnection(state, event),
    INITIAL_CONNECTION,
  );
}

describe("room stream reconnect", () => {
  test("a room event makes the stream live", () => {
    expect(run([{ type: "room" }])).toEqual({ status: "live" });
  });

  test("a drop the browser retries by itself stays connecting", () => {
    expect(run([{ type: "room" }, { type: "dropped", closed: false }])).toEqual(
      { status: "connecting", attempt: 1 },
    );
  });

  test("a stream the browser gave up on waits with growing backoff", () => {
    const first = run([{ type: "room" }, { type: "dropped", closed: true }]);
    expect(first).toEqual({ status: "waiting", attempt: 1, delayMs: 1000 });
    const second = run([
      { type: "dropped", closed: true },
      { type: "reopen" },
      { type: "dropped", closed: true },
    ]);
    expect(second).toEqual({ status: "waiting", attempt: 2, delayMs: 2000 });
  });

  test("a delivered room resets the backoff", () => {
    expect(
      run([
        { type: "dropped", closed: true },
        { type: "reopen" },
        { type: "room" },
        { type: "dropped", closed: true },
      ]),
    ).toEqual({ status: "waiting", attempt: 1, delayMs: 1000 });
  });

  test("the terminal unavailable event retries; refusals stop", () => {
    expect(run([{ type: "terminal", code: "unavailable" }])).toMatchObject({
      status: "waiting",
    });
    expect(run([{ type: "terminal", code: "unauthorized" }])).toEqual({
      status: "stopped",
      reason: "unauthorized",
    });
  });

  test("a stopped stream ignores everything but an explicit reopen", () => {
    const stopped = run([{ type: "terminal", code: "guild_denied" }]);
    expect(nextConnection(stopped, { type: "room" })).toBe(stopped);
    expect(nextConnection(stopped, { type: "dropped", closed: true })).toBe(
      stopped,
    );
    expect(nextConnection(stopped, { type: "reopen" })).toEqual({
      status: "connecting",
      attempt: 0,
    });
  });

  test("backoff is capped at thirty seconds", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 20].map((attempt) => retryDelay(attempt)),
    ).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });

  test("only 401 and 403 from /api/room stop reconnecting", () => {
    expect(refusalFor(401, "sign_in")).toBe("unauthorized");
    expect(refusalFor(403, "feature_disabled")).toBe("feature_disabled");
    expect(refusalFor(403, "guild_denied")).toBe("guild_denied");
    expect(refusalFor(429, "rate_limit")).toBeNull();
    expect(refusalFor(503, "unavailable")).toBeNull();
  });
});
