import { describe, expect, it } from "vitest";
import { recomputeLoadEvidence } from "./load-evidence.ts";
import { loadFixture } from "./test-support/load-fixture.ts";

describe("complete native load command-stream verification", () => {
  it("recomputes all populations from the original windows rather than aggregate labels", () => {
    const input = loadFixture();
    const result = recomputeLoadEvidence(input.measurements, input.log());
    expect(result.pass).toBe(true);
    expect(
      result.rows.map((row) => [row.bots, row.liveTicks, row.fullRosterTicks]),
    ).toEqual([
      [20, 3000, 3000],
      [50, 3000, 3000],
      [100, 3000, 3000],
    ]);
    expect(result.rows[2]).toMatchObject({
      applied: 300_000,
      submitted: 300_000,
      deadlineMet: 300_000,
      deadlineFraction: 1,
    });
  });

  it("catches a tick deleted from both the aggregate and its raw reply", () => {
    const input = loadFixture();
    input.measurements.phases[0]?.ticks.splice(1, 1);
    input.entries
      .find((entry) => entry.phase === 20 && entry.command === "sample")
      ?.state.ticks.splice(1, 1);
    expect(() =>
      recomputeLoadEvidence(input.measurements, input.log()),
    ).toThrow("omitted or duplicated");
  });

  it("rejects aggregate selection and reordered or incomplete windows", () => {
    const input = loadFixture();
    input.measurements.phases[0]?.ticks.pop();
    expect(() =>
      recomputeLoadEvidence(input.measurements, input.log()),
    ).toThrow("differs from the full command stream");
    const other = loadFixture();
    other.entries.pop();
    expect(() =>
      recomputeLoadEvidence(other.measurements, other.log()),
    ).toThrow("incomplete measurement window");
    const reordered = loadFixture();
    reordered.entries.reverse();
    expect(() =>
      recomputeLoadEvidence(reordered.measurements, reordered.log()),
    ).toThrow("reordered phases");
  });

  it("rejects decreasing counters that could inflate deadline delivery", () => {
    const input = loadFixture();
    const first = input.measurements.phases[0]?.before.inference;
    if (first === undefined) throw new Error("unit metrics missing");
    first.skipped = 1;
    expect(() =>
      recomputeLoadEvidence(input.measurements, input.log()),
    ).toThrow("decreasing counters");
    const pending = loadFixture();
    const metrics = pending.measurements.phases[0]?.before.inference;
    if (metrics === undefined) throw new Error("unit metrics missing");
    metrics.submitted = 1;
    expect(() =>
      recomputeLoadEvidence(pending.measurements, pending.log()),
    ).toThrow("starts with pending requests");
    const reset = loadFixture();
    const start = reset.measurements.phases[1]?.before.inference;
    if (start === undefined) throw new Error("unit metrics missing");
    start.submitted = 0;
    start.deadlineMet = 0;
    expect(() =>
      recomputeLoadEvidence(reset.measurements, reset.log()),
    ).toThrow("decreasing counters");
  });

  it("retains slow ticks and final pending requests in the quality denominator", () => {
    const slow = loadFixture();
    for (const tick of slow.measurements.phases[1]?.ticks ?? [])
      tick.milliseconds = 75;
    const result = recomputeLoadEvidence(slow.measurements, slow.log());
    expect(result.pass).toBe(false);
    expect(result.rows[1]?.checks.serverP95).toBe(false);
    const pending = loadFixture();
    for (const entry of pending.entries
      .filter((record) => record.phase === 100)
      .slice(-2)) {
      const metrics = entry.state.inference;
      if (metrics === undefined) throw new Error("unit metrics missing");
      metrics.deadlineMet -= 5000;
      metrics.timely -= 5000;
    }
    const missed = recomputeLoadEvidence(pending.measurements, pending.log());
    expect(missed.rows[2]).toMatchObject({
      pending: 5000,
      checks: { deadlines: false },
      pass: false,
    });
  });

  it("rejects changed match schedules, foreign bodies and impossible completion totals", () => {
    const changed = loadFixture();
    const begin = changed.entries.find(
      (entry) => entry.phase === 20 && entry.command.startsWith("begin"),
    );
    if (begin === undefined) throw new Error("unit begin missing");
    begin.command = "begin 20 700000999";
    expect(() =>
      recomputeLoadEvidence(changed.measurements, changed.log()),
    ).toThrow("controller schedule");
    const oversized = loadFixture();
    const tick = oversized.measurements.phases[0]?.ticks[0];
    if (tick === undefined) throw new Error("unit tick missing");
    tick.alive = 21;
    expect(() =>
      recomputeLoadEvidence(oversized.measurements, oversized.log()),
    ).toThrow("body accounting");
    const impossible = loadFixture();
    const metrics = impossible.measurements.phases[2]?.after.inference;
    if (metrics === undefined) throw new Error("unit metrics missing");
    metrics.deadlineMet += 1;
    expect(() =>
      recomputeLoadEvidence(impossible.measurements, impossible.log()),
    ).toThrow("impossible completion counters");
  });

  it("rejects missing inference, unknown reply fields and blank command records", () => {
    const input = loadFixture();
    const state = input.entries[0]?.state;
    if (state === undefined) throw new Error("unit state missing");
    delete state.inference;
    expect(() =>
      recomputeLoadEvidence(input.measurements, input.log()),
    ).toThrow("metrics missing");
    const valid = loadFixture();
    expect(() =>
      recomputeLoadEvidence(valid.measurements, valid.log() + "\n"),
    ).toThrow();
    const lines = valid.log().split("\n");
    lines[0] = JSON.stringify({ ...valid.entries[0], unexpected: true });
    expect(() =>
      recomputeLoadEvidence(valid.measurements, lines.join("\n")),
    ).toThrow();
  });
});
