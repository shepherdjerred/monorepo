import { describe, expect, it } from "vitest";
import {
  DriverFeedLatencyTracker,
  MAX_PENDING_FRAMES,
} from "./latency-tracker.ts";

function harness() {
  let t = 1000;
  const frameToUnit: number[] = [];
  const inputToUnit: number[] = [];
  let failures = 0;
  const tracker = new DriverFeedLatencyTracker(
    {
      frameToUnit: (ms) => frameToUnit.push(ms),
      inputToUnit: (ms) => inputToUnit.push(ms),
      correlationFailure: () => {
        failures += 1;
      },
    },
    () => t,
  );
  return {
    tracker,
    frameToUnit,
    inputToUnit,
    failures: () => failures,
    at: (ms: number) => {
      t = ms;
    },
  };
}

describe("DriverFeedLatencyTracker", () => {
  it("pairs access units with delivered frames in order", () => {
    const h = harness();
    h.tracker.frameDelivered({ pushedAtMs: 1000 });
    h.tracker.frameDelivered({ pushedAtMs: 1033 });
    h.at(1040);
    h.tracker.unitReady();
    h.at(1070);
    h.tracker.unitReady();
    expect(h.frameToUnit).toEqual([40, 37]);
    expect(h.tracker.pendingFrames).toBe(0);
  });

  it("observes input-to-unit only for frames that carry an input", () => {
    const h = harness();
    h.tracker.frameDelivered({ pushedAtMs: 1000, inputReceivedAtMs: 980 });
    h.tracker.frameDelivered({ pushedAtMs: 1033 });
    h.at(1050);
    h.tracker.unitReady();
    h.tracker.unitReady();
    expect(h.inputToUnit).toEqual([70]);
    expect(h.frameToUnit).toEqual([50, 17]);
  });

  it("ignores output that has no recorded frame", () => {
    const h = harness();
    h.tracker.unitReady();
    expect(h.frameToUnit).toEqual([]);
  });

  it("resets and reports a failure when the queue outgrows any honest backlog", () => {
    const h = harness();
    for (let i = 0; i <= MAX_PENDING_FRAMES; i++) {
      h.tracker.frameDelivered({ pushedAtMs: 1000 + i });
    }
    expect(h.failures()).toBe(1);
    expect(h.tracker.pendingFrames).toBe(0);
  });
});
