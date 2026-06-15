import { describe, expect, it } from "bun:test";
import {
  SOFT_KILL_BEFORE_MS,
  bumpStderrState,
  computeSoftKillDelayMs,
  newStderrState,
} from "./agent-subprocess.ts";

describe("computeSoftKillDelayMs", () => {
  it("returns delay = timeout - safety margin for a realistic 30-min wall", () => {
    // alert-remediation: 30-min activity startToCloseTimeout
    const thirtyMinMs = 30 * 60 * 1000;
    expect(computeSoftKillDelayMs(thirtyMinMs)).toBe(
      thirtyMinMs - SOFT_KILL_BEFORE_MS,
    );
  });

  it("returns delay for the homelab-audit 45-min wall", () => {
    const fortyFiveMinMs = 45 * 60 * 1000;
    expect(computeSoftKillDelayMs(fortyFiveMinMs)).toBe(
      fortyFiveMinMs - SOFT_KILL_BEFORE_MS,
    );
  });

  it("returns undefined when the activity has no startToCloseTimeout (local script driver)", () => {
    const noTimeout: number | undefined = undefined;
    expect(computeSoftKillDelayMs(noTimeout)).toBeUndefined();
  });

  it("returns undefined when the timeout equals the safety margin (no time to soft-kill)", () => {
    expect(computeSoftKillDelayMs(SOFT_KILL_BEFORE_MS)).toBeUndefined();
  });

  it("returns undefined when the timeout is shorter than the safety margin", () => {
    expect(computeSoftKillDelayMs(60_000)).toBeUndefined();
  });
});

describe("StderrState tracking", () => {
  it("initializes with empty line, no idle time", () => {
    const state = newStderrState(1000);
    expect(state.lastStderrLine).toBe("");
    expect(state.lastStderrAt).toBe(1000);
    expect(state.maxIdleMs).toBe(0);
  });

  it("records the most recent line on bump", () => {
    const state = newStderrState(Date.now());
    bumpStderrState(state, "first line");
    expect(state.lastStderrLine).toBe("first line");
    bumpStderrState(state, "second line");
    expect(state.lastStderrLine).toBe("second line");
  });

  it("advances lastStderrAt to the current time on bump", () => {
    const state = newStderrState(Date.now() - 5000);
    const before = Date.now();
    bumpStderrState(state, "x");
    expect(state.lastStderrAt).toBeGreaterThanOrEqual(before);
  });

  it("tracks the longest silence gap as the running maxIdleMs", async () => {
    const state = newStderrState(Date.now());
    bumpStderrState(state, "early line");
    const firstIdle = state.maxIdleMs;

    // Sleep ~50 ms, then bump again. The gap should now exceed the first.
    await new Promise((resolve) => setTimeout(resolve, 50));
    bumpStderrState(state, "after gap");
    expect(state.maxIdleMs).toBeGreaterThan(firstIdle);
    expect(state.maxIdleMs).toBeGreaterThanOrEqual(40);
  });

  it("does not regress maxIdleMs when a later gap is smaller", async () => {
    const state = newStderrState(Date.now());
    // Long gap first.
    await new Promise((resolve) => setTimeout(resolve, 60));
    bumpStderrState(state, "after long gap");
    const longestSoFar = state.maxIdleMs;
    expect(longestSoFar).toBeGreaterThanOrEqual(50);

    // Short gap second — maxIdleMs must stay pinned to the longer gap.
    await new Promise((resolve) => setTimeout(resolve, 10));
    bumpStderrState(state, "after short gap");
    expect(state.maxIdleMs).toBe(longestSoFar);
  });
});
