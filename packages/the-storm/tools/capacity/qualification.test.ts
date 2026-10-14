import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { qualifyCapacity } from "./qualification.ts";
import { runtimeFingerprint } from "#capacity-runtime";
import { runtimeIdentityFixture } from "#e2e/harness/runtime-identity-fixture.ts";

const hash = (digit: string) => digit.repeat(64);
const runtime = runtimeIdentityFixture();
const candidate = {
  artifactSha256: hash("a"),
  fixtureSha256: hash("b"),
  personalityManifestSha256: hash("c"),
  botConfigSha256: hash("d"),
  runtimeSha256: runtimeFingerprint(runtime),
  personalityCount: 512,
};
const maps = ["apex-expanse", "warlords-castles"].map((map) => ({
  map,
  navigationSha256: hash("e"),
  rwfConfigSha256: hash("f"),
  pluginConfigSha256: hash("0"),
}));
const window = {
  p95: 6,
  median: 4,
  max: 9,
  cpu: 1,
  level: 0,
  thinkP95: 5,
  stalenessP95: 5,
  sectionsP95: 1,
  alive: 63,
  boardLag: 1,
  deferred: 0,
  hostLoad: 0,
};
const telemetry = {
  observations: 63,
  ageP95: 3,
  ageMax: 4,
  pendingMax: 0,
  lagP95: 1,
  governorMax: 0,
  overruns: 0,
  thinkMax: 8,
  heapPeak: 1024 ** 3,
  heapLimit: 8 * 1024 ** 3,
};
const memory = {
  current: 2 * 1024 ** 3,
  peak: 3 * 1024 ** 3,
  limit: 10 * 1024 ** 3,
};
const lifecycle = { elapsedMs: 1000, windows: [window], memory: [memory] };

function phase(total: number, beganAt: number) {
  const baseline = total === 0;
  const match = randomUUID();
  const count = baseline ? 90 : 150;
  return {
    total,
    measuredMs: count * 1000,
    mspt: Array.from({ length: count }, () => 5),
    windows: Array.from({ length: count / 10 }, () => ({
      ...window,
      p95: baseline ? 2 : 6,
    })),
    telemetry: Array.from({ length: count / 10 }, () => ({ ...telemetry })),
    memory: Array.from({ length: count }, () => ({ ...memory })),
    matches: baseline
      ? []
      : [
          {
            id: match,
            humans: 1,
            bots: total - 1,
            arrivalMs: 1000,
            arrival: {
              ...lifecycle,
              startedAt: beganAt + 95_000,
              endedAt: beganAt + 96_000,
            },
            startup: telemetry,
            resetMs: 1000,
            reset: {
              ...lifecycle,
              startedAt: beganAt + 271_000,
              endedAt: beganAt + 272_000,
            },
            resetTelemetry: telemetry,
          },
        ],
    measurementWindows: [
      {
        match: baseline ? null : match,
        startedAt: beganAt + (baseline ? 0 : 120_000),
        endedAt: beganAt + (baseline ? 90_000 : 270_000),
      },
    ],
  };
}

function evidence() {
  const sources = [0, 1, 2, 3].map((index) => {
    const beganAt = 1_800_000_000_000 + index * 1_000_000;
    const mapIdentity = maps[Math.floor(index / 2)];
    if (mapIdentity === undefined) throw new Error("missing fixture map");
    const { map, ...identity } = mapIdentity;
    return {
      file: `run-${index.toString()}.json`,
      sha256: hash((index + 1).toString()),
      value: {
        schema: 2,
        runId: randomUUID(),
        beganAt,
        checkpointAt: beganAt + 300_000,
        completedAt: beganAt + 300_000,
        map,
        inputs: {
          ...candidate,
          bootstrap: { initialHeap: "8G", source: "default" },
          runtime: structuredClone(runtime),
          ...identity,
          containerId: index.toString().repeat(64),
          computeWorkers: 6,
          enforcedLimits: { NanoCpus: 8_000_000_000, Memory: 10 * 1024 ** 3 },
        },
        resources: { cpus: 8, heap: "8G", memoryLimit: "10g" },
        rayBudget: "shipped",
        profile: "none",
        phases: [phase(0, beganAt), phase(64, beganAt)],
        // Forged summary labels must not override original observations.
        verdicts: [{ check: "all passed", pass: true }],
      },
    };
  });
  return {
    manifest: {
      schema: 1,
      candidate,
      maps,
      reports: sources.map((source) => source.file),
    },
    sources,
  };
}

describe("capacity qualification from original repeated runs", () => {
  it("qualifies only the measured tier on both maps, retaining incomplete full-matrix and deployment gates", () => {
    const { manifest, sources } = evidence();
    const result = qualifyCapacity(manifest, sources);
    expect(result.recommendation).toEqual({ total: 64, cpus: 8, workers: 6 });
    expect(result.pairs.find((pair) => pair.cpus === 8)?.fullMatrixPassed).toBe(
      false,
    );
    expect(result.deploymentAccepted).toBe(false);
    expect(result.remainingGates).toContain("rendered native combat");
  });

  it("does not replace a missing map repetition with two runs on another map", () => {
    const { manifest, sources } = evidence();
    const fourth = sources[3];
    if (fourth === undefined) throw new Error("missing fixture");
    fourth.value.map = "apex-expanse";
    expect(qualifyCapacity(manifest, sources).recommendation).toBeNull();
  });

  it("recomputes a failed deadline despite supplied passing labels", () => {
    const { manifest, sources } = evidence();
    const sample = sources[0]?.value.phases[1]?.telemetry[0];
    if (sample === undefined) throw new Error("missing fixture sample");
    sample.overruns = 1;
    expect(qualifyCapacity(manifest, sources).recommendation).toBeNull();
  });

  it("rejects duplicated original reports and repeated containers", () => {
    const { manifest, sources } = evidence();
    const first = sources[0];
    const second = sources[1];
    if (first === undefined || second === undefined)
      throw new Error("missing fixtures");
    second.sha256 = first.sha256;
    expect(() => qualifyCapacity(manifest, sources)).toThrow("Duplicate");
    second.sha256 = hash("2");
    second.value.inputs.containerId = first.value.inputs.containerId;
    expect(() => qualifyCapacity(manifest, sources)).toThrow("Duplicate");
  });

  it("rejects changed binaries, configuration or enforced resource limits", () => {
    for (const field of [
      "artifactSha256",
      "fixtureSha256",
      "botConfigSha256",
      "rwfConfigSha256",
      "navigationSha256",
    ] as const) {
      const { manifest, sources } = evidence();
      const first = sources[0];
      if (first === undefined) throw new Error("missing fixture");
      first.value.inputs[field] = hash("9");
      expect(() => qualifyCapacity(manifest, sources)).toThrow(
        /candidate|inputs changed/u,
      );
    }
    const { manifest, sources } = evidence();
    const first = sources[0];
    if (first === undefined) throw new Error("missing fixture");
    first.value.inputs.enforcedLimits.NanoCpus = 4_000_000_000;
    expect(() => qualifyCapacity(manifest, sources)).toThrow(
      "enforced experiment",
    );
  });

  it("refuses overlapping runs and a third selectively chosen repetition", () => {
    const { manifest, sources } = evidence();
    const first = sources[0];
    const second = sources[1];
    if (first === undefined || second === undefined)
      throw new Error("missing fixtures");
    first.value.completedAt = second.value.beganAt + 1;
    first.value.checkpointAt = first.value.completedAt;
    expect(qualifyCapacity(manifest, sources).recommendation).toBeNull();
    const clean = evidence();
    const extra = evidence().sources[0];
    if (extra === undefined) throw new Error("missing fixture");
    extra.file = "extra.json";
    extra.sha256 = hash("8");
    extra.value.inputs.containerId = "f".repeat(64);
    clean.sources.push(extra);
    clean.manifest.reports.push(extra.file);
    expect(
      qualifyCapacity(clean.manifest, clean.sources).recommendation,
    ).toBeNull();
  });

  it("rejects measuring windows attributed to another match", () => {
    const { manifest, sources } = evidence();
    const interval = sources[0]?.value.phases[1]?.measurementWindows[0];
    if (interval === undefined) throw new Error("missing fixture interval");
    interval.match = randomUUID();
    expect(() => qualifyCapacity(manifest, sources)).toThrow(
      "original run/match",
    );
  });

  it("rejects truncated, overlapping or post-completion intervals", () => {
    const short = evidence();
    const interval = short.sources[0]?.value.phases[1]?.measurementWindows[0];
    if (interval === undefined) throw new Error("missing fixture interval");
    interval.startedAt = interval.endedAt - 1;
    expect(() => qualifyCapacity(short.manifest, short.sources)).toThrow(
      "omit measured time",
    );
    const overlap = evidence();
    const live = overlap.sources[0]?.value.phases[1];
    const original = live?.measurementWindows[0];
    if (live === undefined || original === undefined)
      throw new Error("missing fixture phase");
    live.measurementWindows.push({ ...original });
    expect(() => qualifyCapacity(overlap.manifest, overlap.sources)).toThrow(
      "original run/match",
    );
    const ended = evidence();
    const first = ended.sources[0];
    if (first === undefined) throw new Error("missing fixture");
    first.value.completedAt = first.value.beganAt + 200_000;
    expect(() => qualifyCapacity(ended.manifest, ended.sources)).toThrow(
      "original run/match",
    );
  });

  it("rejects malformed original digests and runtime changes", () => {
    const broken = evidence();
    const first = broken.sources[0];
    if (first === undefined) throw new Error("missing fixture");
    first.sha256 = "not-a-digest";
    expect(() => qualifyCapacity(broken.manifest, broken.sources)).toThrow();
    first.sha256 = hash("1");
    first.value.inputs.runtimeSha256 = hash("2");
    expect(() => qualifyCapacity(broken.manifest, broken.sources)).toThrow(
      "different candidate",
    );
  });

  it("requires original settling and cleanup clocks", () => {
    const lateArrival = evidence();
    const arrival =
      lateArrival.sources[0]?.value.phases[1]?.matches[0]?.arrival;
    const beganAt = lateArrival.sources[0]?.value.beganAt;
    if (arrival === undefined || beganAt === undefined)
      throw new Error("missing fixture arrival");
    arrival.startedAt = beganAt + 100_000;
    arrival.endedAt = beganAt + 101_000;
    expect(() =>
      qualifyCapacity(lateArrival.manifest, lateArrival.sources),
    ).toThrow("settling period");
    const earlyCompletion = evidence();
    const first = earlyCompletion.sources[0];
    if (first === undefined) throw new Error("missing fixture");
    first.value.completedAt = first.value.beganAt + 271_500;
    expect(() =>
      qualifyCapacity(earlyCompletion.manifest, earlyCompletion.sources),
    ).toThrow("lifecycle clock");
    const unfinished = evidence();
    expect(
      qualifyCapacity(
        unfinished.manifest,
        unfinished.sources.map((source) => ({
          ...source,
          value: { ...source.value, completedAt: undefined },
        })),
      ).recommendation,
    ).toBeNull();
  });

  it("rehashes actual runtime details instead of trusting their declared fingerprint", () => {
    const { manifest, sources } = evidence();
    const first = sources[0];
    if (first === undefined) throw new Error("missing fixture");
    first.value.inputs.runtime.javaArgumentsSha256 = hash("f");
    expect(() => qualifyCapacity(manifest, sources)).toThrow(
      "runtime details differ",
    );
  });
});

describe("capacity heap bootstrap qualification", () => {
  it("qualifies a consistent1G bootstrap and rejects a requested floor that actual JVM flags did not apply", () => {
    const wrong = evidence();
    const first = wrong.sources[0];
    if (first === undefined) throw new Error("missing fixture");
    first.value.inputs.bootstrap = { initialHeap: "1G", source: "environment" };
    expect(() => qualifyCapacity(wrong.manifest, wrong.sources)).toThrow(
      "declared bootstrap",
    );
    const data = evidence();
    for (const source of data.sources) {
      source.value.inputs.bootstrap = {
        initialHeap: "1G",
        source: "environment",
      };
      source.value.inputs.runtime.heap.initialBytes = 1024 ** 3;
      source.value.inputs.runtimeSha256 = runtimeFingerprint(
        source.value.inputs.runtime,
      );
    }
    const updated = data.sources[0];
    if (updated === undefined) throw new Error("missing fixture");
    data.manifest.candidate.runtimeSha256 = updated.value.inputs.runtimeSha256;
    expect(
      qualifyCapacity(data.manifest, data.sources).recommendation,
    ).not.toBeNull();
    updated.value.inputs.bootstrap = {
      initialHeap: "8G",
      source: "environment",
    };
    expect(() => qualifyCapacity(data.manifest, data.sources)).toThrow(
      "declared bootstrap",
    );
  });
});
