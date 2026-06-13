import { describe, expect, it } from "bun:test";
import { InputLatencyTracker } from "./input-latency-tracker.ts";

// Deterministic clock the tests advance by hand.
function makeClock(start = 1000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("InputLatencyTracker", () => {
  it("observes the receipt-to-drain delay exactly once", () => {
    const clock = makeClock();
    const tracker = new InputLatencyTracker(4, clock.now);
    tracker.record(0);
    clock.advance(12);

    const observed: number[] = [];
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed).toEqual([12]);

    // Second drain with nothing new pending observes nothing.
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed).toEqual([12]);
  });

  it("keeps the earliest timestamp when input is re-sent before a tick", () => {
    const clock = makeClock();
    const tracker = new InputLatencyTracker(4, clock.now);
    tracker.record(1);
    clock.advance(20);
    tracker.record(1); // re-send must not reset the wait

    clock.advance(5);
    const observed: number[] = [];
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed).toEqual([25]);
  });

  it("observes again for input arriving after a drain", () => {
    const clock = makeClock();
    const tracker = new InputLatencyTracker(4, clock.now);
    tracker.record(2);
    const first: number[] = [];
    tracker.drainAll((ms) => first.push(ms));
    expect(first).toHaveLength(1);

    tracker.record(2);
    clock.advance(7);
    const observed: number[] = [];
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed).toEqual([7]);
  });

  it("drains every pending seat in one pass", () => {
    const clock = makeClock();
    const tracker = new InputLatencyTracker(4, clock.now);
    tracker.record(0);
    clock.advance(10);
    tracker.record(3);
    clock.advance(5);

    const observed: number[] = [];
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed.toSorted((a, b) => a - b)).toEqual([5, 15]);
  });

  it("clear drops a pending sample", () => {
    const clock = makeClock();
    const tracker = new InputLatencyTracker(4, clock.now);
    tracker.record(1);
    tracker.clear(1);

    const observed: number[] = [];
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed).toEqual([]);
  });

  it("ignores out-of-range seats", () => {
    const clock = makeClock();
    const tracker = new InputLatencyTracker(4, clock.now);
    tracker.record(-1);
    tracker.record(4);
    tracker.clear(-1);
    tracker.clear(4);

    const observed: number[] = [];
    tracker.drainAll((ms) => observed.push(ms));
    expect(observed).toEqual([]);
  });
});
