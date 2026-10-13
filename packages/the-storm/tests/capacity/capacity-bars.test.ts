import { afterEach, describe, expect, it, vi } from "vitest";
import {
  capacityNativeTotal,
  capacityResources,
  capacityWorkers,
} from "#e2e/gameplay-fixtures.ts";
import {
  capacityTierVerdicts,
  capacityVerdicts,
  totals,
  type CapacityPhase,
  type Telemetry,
} from "./capacity-bars.ts";

const healthy: Telemetry = {
  observations: 1000,
  ageP95: 3,
  ageMax: 4,
  pendingMax: 0,
  lagP95: 1,
  governorMax: 0,
  overruns: 0,
  thinkMax: 4,
  heapPeak: 1024 ** 3,
  heapLimit: 8 * 1024 ** 3,
};
function phase(total: number): CapacityPhase {
  return {
    total,
    measuredMs: total === 0 ? 90_000 : 150_000,
    mspt: Array.from({ length: 150 }, () => 2),
    windows: Array.from({ length: 15 }, () => ({
      p95: 4,
      median: 2,
      max: 10,
      cpu: 2,
      level: 0,
      thinkP95: 4,
      stalenessP95: 5,
      sectionsP95: 2,
      alive: Math.max(0, total - 1),
      boardLag: 1,
      deferred: 0,
      hostLoad: 1,
    })),
    telemetry: Array.from({ length: 15 }, () => ({ ...healthy })),
    memory: Array.from({ length: 150 }, () => ({
      current: 2 * 1024 ** 3,
      peak: 3 * 1024 ** 3,
      limit: 10 * 1024 ** 3,
    })),
    matches:
      total === 0
        ? []
        : [
            {
              id: "00000000-0000-4000-8000-000000000001",
              humans: 1,
              bots: total - 1,
              arrivalMs: 60_000,
              arrival: { elapsedMs: 60_000, windows: [], memory: [] },
              startup: healthy,
              resetMs: 3000,
              reset: { elapsedMs: 3000, windows: [], memory: [] },
              resetTelemetry: healthy,
            },
          ],
  };
}
const matrix = () => [phase(0), ...totals.map((total) => phase(total))];

describe("capacity CPU calibration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps the shipped ceiling and accepts only worker budgets that reserve a CPU", () => {
    vi.stubEnv("STORM_CAPACITY_WORKERS", undefined);
    for (const [cpus, workers] of [
      [3, 2],
      [4, 3],
      [6, 4],
      [8, 4],
      [12, 4],
    ] as const) {
      vi.stubEnv("STORM_CAPACITY_CPUS", cpus.toString());
      expect(capacityWorkers()).toBe(workers);
    }
    for (const [cpus, workers] of [
      [3, 2],
      [4, 3],
      [6, 4],
      [8, 6],
      [12, 10],
    ] as const) {
      vi.stubEnv("STORM_CAPACITY_CPUS", cpus.toString());
      vi.stubEnv("STORM_CAPACITY_WORKERS", workers.toString());
      expect(capacityWorkers()).toBe(workers);
    }
    vi.stubEnv("STORM_CAPACITY_CPUS", "8");
    for (const workers of ["", "0", "8", "10", "11", "2.5", "invalid"]) {
      vi.stubEnv("STORM_CAPACITY_WORKERS", workers);
      expect(capacityWorkers).toThrow();
    }
  });

  it("keeps native acceptance at 256 by default and rejects unsupported tier selections", () => {
    vi.stubEnv("STORM_CAPACITY_NATIVE_TOTAL", undefined);
    expect(capacityNativeTotal()).toBe(256);
    for (const total of totals) {
      vi.stubEnv("STORM_CAPACITY_NATIVE_TOTAL", total.toString());
      expect(capacityNativeTotal()).toBe(total);
    }
    for (const total of ["", "0", "63", "512", "invalid"]) {
      vi.stubEnv("STORM_CAPACITY_NATIVE_TOTAL", total);
      expect(capacityNativeTotal).toThrow();
    }
  });

  it("allows only the approved CPU budgets and keeps the memory budget fixed", () => {
    vi.stubEnv("STORM_CAPACITY_CPUS", undefined);
    expect(capacityResources()).toEqual({
      cpus: 3,
      heap: "8G",
      memoryLimit: "10g",
    });
    for (const cpus of [3, 4, 6, 8, 12]) {
      vi.stubEnv("STORM_CAPACITY_CPUS", cpus.toString());
      expect(capacityResources()).toEqual({
        cpus,
        heap: "8G",
        memoryLimit: "10g",
      });
    }
    for (const cpus of ["", "2", "16", "3.5", "invalid"]) {
      vi.stubEnv("STORM_CAPACITY_CPUS", cpus);
      expect(capacityResources).toThrow();
    }
  });
});

describe("capacity release gates", () => {
  it("judges a measured tier independently while retaining a failed incomplete matrix", () => {
    const phases = [phase(0), phase(64)];
    expect(totals).toEqual([64, 100, 128, 192, 256]);
    expect(capacityTierVerdicts(phases, 64).every((v) => v.pass)).toBe(true);
    expect(capacityVerdicts(phases).some((v) => !v.pass)).toBe(true);
    expect(capacityTierVerdicts(phases, 128).every((v) => v.pass)).toBe(false);
    expect(capacityTierVerdicts([phase(64)], 64).every((v) => v.pass)).toBe(
      false,
    );
    const low = phases[1];
    if (low === undefined) throw new Error("Missing fixture");
    low.telemetry[0] = { ...healthy, overruns: 1 };
    expect(capacityTierVerdicts(phases, 64)).toContainEqual({
      check: "64 total: think jobs over 50 ms",
      value: 1,
      bar: 0,
      pass: false,
    });
  });

  it("accepts a complete healthy matrix and rejects missing phases or baseline", () => {
    expect(capacityVerdicts(matrix()).every((v) => v.pass)).toBe(true);
    expect(
      capacityVerdicts(matrix().filter((p) => p.total !== 192)).some(
        (v) => !v.pass,
      ),
    ).toBe(true);
    expect(
      capacityVerdicts(matrix().filter((p) => p.total !== 0)).some(
        (v) => !v.pass,
      ),
    ).toBe(true);
  });

  it("rejects one slow job even when recent think p95 is low", () => {
    const phases = matrix();
    const high = phases.find((p) => p.total === 256);
    if (high === undefined) throw new Error("Missing fixture");
    high.telemetry[2] = { ...healthy, overruns: 1, thinkMax: 51 };
    expect(capacityVerdicts(phases)).toContainEqual({
      check: "256 total: think jobs over 50 ms",
      value: 1,
      bar: 0,
      pass: false,
    });
  });

  it("rejects an abbreviated baseline", () => {
    const phases = matrix();
    const base = phases.find((p) => p.total === 0);
    if (base === undefined) throw new Error("Missing fixture");
    base.measuredMs = 89_999;
    expect(capacityVerdicts(phases).some((v) => !v.pass)).toBe(true);
  });

  it("rejects a live job completed after the final live poll", () => {
    const phases = matrix();
    const match = phases.find((p) => p.total === 256)?.matches[0];
    if (match === undefined) throw new Error("Missing fixture");
    match.resetTelemetry = { ...healthy, overruns: 1 };
    expect(capacityVerdicts(phases)).toContainEqual({
      check: "256 total: think jobs over 50 ms",
      value: 1,
      bar: 0,
      pass: false,
    });
  });

  it.each([
    ["ageP95", 6],
    ["ageMax", 11],
    ["pendingMax", 1],
    ["governorMax", 1],
    ["lagP95", 4],
    ["observations", 0],
  ] as const)(
    "rejects a bad %s sample at the smallest capacity too",
    (key, value) => {
      const phases = matrix();
      const low = phases.find((p) => p.total === 100);
      if (low === undefined) throw new Error("Missing fixture");
      low.telemetry[0] = { ...healthy, [key]: value };
      expect(
        capacityVerdicts(phases).some(
          (v) => v.check.startsWith("100 total:") && !v.pass,
        ),
      ).toBe(true);
    },
  );

  it("rejects a brief tick spike, heap pressure and an incorrect roster", () => {
    const phases = matrix();
    const high = phases.find((p) => p.total === 256);
    if (high === undefined) throw new Error("Missing fixture");
    const first = high.windows[0];
    if (first === undefined) throw new Error("Missing fixture window");
    high.windows[0] = { ...first, p95: 50 };
    high.telemetry[0] = { ...healthy, heapPeak: 8 * 1024 ** 3 };
    const match = high.matches[0];
    if (match === undefined) throw new Error("Missing fixture match");
    match.bots = 256;
    const failed = capacityVerdicts(phases)
      .filter((v) => !v.pass)
      .map((v) => v.check);
    expect(failed).toEqual(
      expect.arrayContaining([
        "256 total: added tick p95 ms",
        "256 total: tick p95 ms",
        "256 total: heap fraction",
        "256 total: exact mixed roster and cleanup",
      ]),
    );
  });

  it("retains heap pressure during startup and arrival", () => {
    const phases = matrix();
    const base = phases.find((p) => p.total === 0);
    const low = phases.find((p) => p.total === 100);
    if (base === undefined || low?.matches[0] === undefined)
      throw new Error("Missing fixture");
    low.matches[0].startup = { ...healthy, heapPeak: 8 * 1024 ** 3 };
    expect(
      capacityVerdicts(phases).find(
        (v) => v.check === "100 total: heap fraction",
      )?.pass,
    ).toBe(false);
    low.matches[0].startup = healthy;
    base.telemetry[0] = { ...healthy, heapPeak: 8 * 1024 ** 3 };
    expect(
      capacityVerdicts(phases)
        .filter((v) => v.check.endsWith("heap fraction"))
        .every((v) => !v.pass),
    ).toBe(true);
  });

  it("retains heap and container pressure during the final reset", () => {
    const phases = matrix();
    const match = phases.find((p) => p.total === 256)?.matches[0];
    if (match?.reset === undefined) throw new Error("Missing fixture");
    match.resetTelemetry = { ...healthy, heapPeak: 8 * 1024 ** 3 };
    match.reset.memory.push({
      current: 9 * 1024 ** 3,
      peak: 9 * 1024 ** 3,
      limit: 10 * 1024 ** 3,
    });
    const failed = capacityVerdicts(phases)
      .filter((v) => !v.pass)
      .map((v) => v.check);
    expect(failed).toEqual(
      expect.arrayContaining([
        "256 total: heap fraction",
        "256 total: container fraction including startup and reset",
      ]),
    );
  });
});
