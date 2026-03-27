import { describe, test, expect } from "bun:test";
import { createTimer } from "#lib/timer/countdown.ts";

describe("timer", () => {
  test("starts with correct duration", () => {
    const timer = createTimer(25);
    expect(timer.getRemainingMs()).toBeGreaterThan(24 * 60 * 1000);
    expect(timer.getPhase()).toBe("first_half");
  });

  test("displays time correctly", () => {
    const timer = createTimer(25);
    const display = timer.getDisplayTime();
    expect(display).toContain("remaining");
    expect(display).toMatch(/\d+:\d{2}/); // matches mm:ss format
  });

  test("saves and resumes state", () => {
    const timer = createTimer(25);
    const state = timer.getState();

    expect(state.durationMs).toBe(25 * 60 * 1000);
    expect(state.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(state.warningsEmitted).toHaveLength(0);

    // Resume from saved state
    const timer2 = createTimer(25);
    timer2.resume({
      ...state,
      elapsedMs: 13 * 60 * 1000, // 13 minutes elapsed
    });

    expect(timer2.getPhase()).toBe("past_50");
  });

  test("emits warnings at milestones", () => {
    const timer = createTimer(10); // 10 minute timer

    // Simulate 6 minutes elapsed (past 50%)
    timer.resume({
      durationMs: 10 * 60 * 1000,
      elapsedMs: 6 * 60 * 1000,
      warningsEmitted: [],
      lastCheckpointMs: Date.now(),
    });

    const warnings = timer.checkWarnings();
    expect(warnings.length).toBeGreaterThanOrEqual(1);

    // Second check should not re-emit
    const warnings2 = timer.checkWarnings();
    expect(warnings2).toHaveLength(0);
  });

  test("detects overtime", () => {
    const timer = createTimer(1); // 1 minute timer
    timer.resume({
      durationMs: 60 * 1000,
      elapsedMs: 2 * 60 * 1000, // 2 minutes elapsed
      warningsEmitted: [],
      lastCheckpointMs: Date.now(),
    });

    expect(timer.getPhase()).toBe("overtime");
    expect(timer.getDisplayTime()).toContain("OVERTIME");
  });
});
