import { describe, expect, test } from "vitest";
import { LoadSample, type LoadTick } from "./load-client.ts";
import { inferenceDrained, loadSummary, percentile } from "./load-gate.ts";

function state(submitted: number, deadlineMet: number, extra = {}) {
  return LoadSample.parse({
    protocol: 1,
    contract: "rwf-inference-load-v1",
    ready: true,
    result: "live",
    phase: "LIVE",
    match: "00000000-0000-4000-8000-000000000001",
    seed: 1,
    bots: 100,
    ticks: [],
    ages: [0, submitted, 0],
    damageEvents: submitted,
    damage: submitted,
    inference: {
      submitted,
      skipped: 0,
      timely: deadlineMet,
      stale: 0,
      expired: 0,
      contextDrops: 0,
      deadlineMet,
      deadlineMissed: 0,
      resets: 100,
      rejected: 0,
      hits: submitted,
      misses: 0,
      maximumNanos: 1_000_000,
      maximumBatch: 100,
      ...extra,
    },
  });
}

function ticks(alive = 100): LoadTick[] {
  return Array.from({ length: 3000 }, (_, index) => ({
    serverTick: index + 1,
    milliseconds: 5,
    match: "00000000-0000-4000-8000-000000000001",
    botTick: index + 1,
    alive,
    observed: alive,
    applied: alive,
    unavailable: 0,
    ineligible: 0,
    live: true,
  }));
}

describe("native inference load evidence", () => {
  test("starts the next window only after prior requests are accounted for", () => {
    expect(inferenceDrained(state(100, 99))).toBe(false);
    expect(inferenceDrained(state(100, 100))).toBe(true);
    expect(inferenceDrained(state(100, 99, { deadlineMissed: 1 }))).toBe(true);
    expect(() => inferenceDrained(state(100, 101))).toThrow("accounting");
    const missing = state(0, 0);
    delete missing.inference;
    expect(() => inferenceDrained(missing)).toThrow("metrics missing");
  });
  test("requires the full roster and uses every actual server tick", () => {
    const before = state(0, 0);
    const after = state(300_000, 299_900);
    expect(loadSummary(100, ticks(), before, after).pass).toBe(true);
    const depleted = ticks(99);
    const reduced = { ...after, ages: [0, 297_000, 0] };
    expect(
      loadSummary(100, depleted, before, reduced).checks.fullRosterCoverage,
    ).toBe(false);
    const slow = ticks().map((tick, index) => ({
      ...tick,
      milliseconds: index < 200 ? 51 : 5,
    }));
    expect(loadSummary(100, slow, before, after).checks.serverP95).toBe(false);
    expect(percentile([1, 1, 1, 90], 0.95)).toBe(90);
  });

  test("skipped, rejected, expired and final pending work count against deadlines", () => {
    const before = state(0, 0);
    const after = state(300_000, 290_000, {
      contextDrops: 10_000,
      deadlineMissed: 10_000,
    });
    expect(loadSummary(100, ticks(), before, after).checks.deadlines).toBe(
      false,
    );
    expect(
      loadSummary(100, ticks(), before, state(300_000, 296_999)).checks
        .deadlines,
    ).toBe(false);
    expect(
      loadSummary(
        100,
        ticks(),
        before,
        state(300_000, 300_000, { skipped: 4000 }),
      ).checks.deadlines,
    ).toBe(false);
    expect(
      loadSummary(
        100,
        ticks(),
        before,
        state(300_000, 300_000, { rejected: 4000 }),
      ).checks.deadlines,
    ).toBe(false);
  });

  test("counts a timely retired context without claiming action delivery", () => {
    const after = state(300_000, 299_900, {
      timely: 290_000,
      contextDrops: 9900,
    });
    expect(loadSummary(100, ticks(), state(0, 0), after).checks.deadlines).toBe(
      true,
    );
    expect(() =>
      loadSummary(100, ticks(), state(0, 0), state(300_000, 300_001)),
    ).toThrow("accounting");
    expect(() => percentile([], 0.95)).toThrow("empty");
  });
});
