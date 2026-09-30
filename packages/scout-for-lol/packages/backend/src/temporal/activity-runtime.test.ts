import { afterEach, describe, expect, test, vi } from "vitest";

/**
 * The heartbeat cadence, which is a correctness property rather than a tuning
 * knob.
 *
 * Temporal fires an Activity's heartbeat timeout at `last beat + timeout`. A
 * beat interval EQUAL to that timeout therefore races it and loses about half
 * the time: the Activity is alive and beating, and the server reaps it anyway.
 * What reaches the Workflow is a bare Activity timeout — which the notification
 * send cannot tell apart from a Discord request that went unanswered, and
 * records as `unknown-delivery`, a dead end only an operator leaves.
 *
 * So the interval is derived from the Activity's own heartbeat timeout and
 * must stay comfortably under it. Mutation proof: pin the interval back to a
 * fixed 10s and the first case fails, because a 10s-timeout Activity beats
 * exactly on its own deadline.
 */

const heartbeats: unknown[] = [];
let heartbeatTimeoutMs: number | undefined = 10_000;

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      info: { heartbeatTimeoutMs },
      heartbeat: (details: unknown) => {
        heartbeats.push(details);
      },
    }),
  },
}));

const { heartbeatWhile } = await import("#src/temporal/activity-runtime.ts");

afterEach(() => {
  vi.useRealTimers();
  heartbeats.length = 0;
  heartbeatTimeoutMs = 10_000;
});

function unstarted(): void {
  throw new Error("the action was never started");
}

/** Beats emitted while an action runs for `durationMs`, first beat included. */
async function beatsDuring(durationMs: number): Promise<number> {
  vi.useFakeTimers();
  let finish: () => void = unstarted;
  const action = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const running = heartbeatWhile({ phase: "test" }, async () => {
    await action;
  });
  await vi.advanceTimersByTimeAsync(durationMs);
  finish();
  await running;
  return heartbeats.length;
}

describe("heartbeatWhile", () => {
  test("beats more than once inside a ten-second heartbeat timeout", async () => {
    // Twice within the timeout is the property: one beat is the opening one,
    // and the timeout must never be reached without another following it.
    expect(await beatsDuring(9000)).toBeGreaterThan(1);
  });

  test("scales the interval with the Activity's own timeout", async () => {
    heartbeatTimeoutMs = 30_000;

    // A long-timeout Activity does not need a beat every three seconds, and
    // the SDK would throttle them anyway.
    expect(await beatsDuring(9000)).toBe(1);
    expect(await beatsDuring(21_000)).toBeGreaterThan(1);
  });

  test("still beats for an Activity whose options set no heartbeat timeout", async () => {
    heartbeatTimeoutMs = undefined;

    expect(await beatsDuring(21_000)).toBeGreaterThan(1);
  });

  test("stops beating once the action settles", async () => {
    vi.useFakeTimers();
    await heartbeatWhile({ phase: "test" }, () => Promise.resolve("done"));
    const afterSettling = heartbeats.length;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(heartbeats).toHaveLength(afterSettling);
  });
});
