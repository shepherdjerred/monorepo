import { expect, test } from "vitest";
import { benchmarkEvidence } from "#lib/ci/benchmark-evidence.ts";
import { boundedBenchmarkBody } from "#lib/ci/benchmark-store.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

const head = "a".repeat(40);
const expected = { head, variant: "candidate" as const };
function native(): WoodpeckerPipeline {
  return {
    number: 123,
    commit: head,
    branch: "ci-canary/test",
    event: "manual",
    status: "success",
    rerun_count: 0,
    workflows: [{ name: "verify", state: "success", started: 1, finished: 22 }],
  };
}
function fixture() {
  return {
    version: 1,
    pipeline: "123",
    commit: head,
    workflow: "verify",
    startedAt: 1000,
    finishedAt: 21_000,
    exitCode: 0,
    collectionFailed: false,
    benchmarkResources: {
      version: 1,
      variant: "candidate",
      intervalMs: 10_000,
      collectionFailed: false,
      samples: [1000, 11_000, 21_001].map((at) => ({
        at,
        memory: {
          currentBytes: 100,
          peakBytes: 200,
          limitBytes: 36 * 1024 ** 3,
          limitHits: 0,
          oomEvents: 0,
          oomKills: 0,
        },
        filesystems: ["/woodpecker/tmp", "/woodpecker/gradle"].map(
          (path, index) => {
            const capacityBytes = (index === 0 ? 8 : 4) * 1024 ** 3;
            return {
              path,
              filesystem: "tmpfs",
              capacityBytes,
              usedBytes: 100,
              availableBytes: capacityBytes - 100,
            };
          },
        ),
      })),
    },
    turbo: [
      { execution: { success: 21, failed: 0, cached: 389, attempted: 410 } },
    ],
  };
}
function inspect(change: (report: ReturnType<typeof fixture>) => void) {
  const report = fixture();
  change(report);
  return benchmarkEvidence(JSON.stringify(report), native(), expected);
}

test("accepts the producer's final sample immediately after command exit and preserves limitations", () => {
  const result = benchmarkEvidence(
    JSON.stringify(fixture()),
    native(),
    expected,
  );
  expect(result.collectionComplete).toBe(true);
  expect(result.resourceHealthy).toBe(true);
  expect(result.taskSuccess).toBe(true);
  expect(result.coverage.finalEndpointSkewMs).toBe(1);
  expect(result.physicalQualification).toBe(false);
  expect(result.productionQualified).toBe(false);
  expect(result.resources.samples).toHaveLength(3);
});

test("a failed workload retains complete resource evidence and its nonzero exit", () => {
  const report = fixture();
  report.exitCode = 1;
  report.turbo[0]!.execution = {
    success: 21,
    failed: 1,
    cached: 388,
    attempted: 410,
  };
  const pipeline = native();
  pipeline.status = "failure";
  pipeline.workflows[0]!.state = "failure";
  const result = benchmarkEvidence(JSON.stringify(report), pipeline, expected);
  expect(result.collectionComplete).toBe(true);
  expect(result.resourceHealthy).toBe(true);
  expect(result.taskSuccess).toBe(false);
  expect(result.command.exitCode).toBe(1);
  expect(result.counts).toEqual({
    success: 21,
    failed: 1,
    cached: 388,
    attempted: 410,
  });
});

test.each([
  { commit: "b".repeat(40) },
  { number: 124 },
  { event: "push" },
  { branch: "main" },
  { workflows: [{ name: "other", state: "success" }] },
  { status: "running" },
  { rerun_count: 1 },
  {
    workflows: [{ name: "verify", state: "success", started: 2, finished: 22 }],
  },
])(
  "rejects an unrelated, nonterminal or ambiguous native receipt: %j",
  (changes) => {
    expect(() =>
      benchmarkEvidence(
        JSON.stringify(fixture()),
        { ...native(), ...changes },
        expected,
      ),
    ).toThrow();
  },
);

test("rejects report identity changes and missing producer resources", () => {
  for (const changes of [
    { pipeline: "124" },
    { commit: "b".repeat(40) },
    { workflow: "playwright-e2e" },
    { benchmarkResources: undefined },
  ])
    expect(() =>
      benchmarkEvidence(
        JSON.stringify({ ...fixture(), ...changes }),
        native(),
        expected,
      ),
    ).toThrow();
  expect(() =>
    benchmarkEvidence(JSON.stringify(fixture()), native(), {
      ...expected,
      variant: "baseline",
    }),
  ).toThrow();
});

test.each([
  (r: ReturnType<typeof fixture>) => {
    r.collectionFailed = true;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.collectionFailed = true;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[1]!.at = 999;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples.pop();
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[2]!.memory.peakBytes = 199;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[2]!.memory.limitBytes--;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[1]!.memory.oomEvents = 1;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[2]!.filesystems[0]!.capacityBytes--;
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[2]!.filesystems[0]!.filesystem = "shared";
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[2]!.filesystems[1]!.path = "/woodpecker/tmp";
  },
  (r: ReturnType<typeof fixture>) => {
    r.benchmarkResources.samples[2]!.filesystems[0]!.availableBytes++;
  },
  (r: ReturnType<typeof fixture>) => {
    r.turbo[0]!.execution.attempted++;
  },
])(
  "does not accept incomplete, reset or inconsistent evidence (#%#)",
  (change) => {
    expect(inspect(change).collectionComplete).toBe(false);
  },
);

test("a missing final sample outside endpoint tolerance is incomplete", () => {
  const report = fixture();
  report.finishedAt = 60_000;
  const pipeline = native();
  pipeline.workflows[0]!.finished = 61;
  expect(
    benchmarkEvidence(JSON.stringify(report), pipeline, expected)
      .collectionComplete,
  ).toBe(false);
});

test("the initial sample brackets command start, including setup clock skew", () => {
  expect(
    inspect((r) => {
      r.benchmarkResources.samples[0]!.at = 999;
    }).collectionComplete,
  ).toBe(true);
  expect(
    inspect((r) => {
      r.benchmarkResources.samples[0]!.at = 1001;
    }).collectionComplete,
  ).toBe(false);
});

test("OOM and full-volume observations fail resource health without losing collection", () => {
  for (const change of [
    (r: ReturnType<typeof fixture>) => {
      r.benchmarkResources.samples[2]!.memory.oomKills = 1;
    },
    (r: ReturnType<typeof fixture>) => {
      r.benchmarkResources.samples[2]!.filesystems[0]!.availableBytes = 0;
    },
  ]) {
    const result = inspect(change);
    expect(result.collectionComplete).toBe(true);
    expect(result.resourceHealthy).toBe(false);
  }
});

test("baseline shared capacities are not mistaken for directory usage", () => {
  const report = fixture();
  report.benchmarkResources.variant = "baseline";
  for (const sample of report.benchmarkResources.samples) {
    sample.memory.limitBytes = 24 * 1024 ** 3;
    for (const fs of sample.filesystems) {
      fs.filesystem = "shared";
      fs.capacityBytes = 400 * 1024 ** 3;
    }
  }
  const result = benchmarkEvidence(JSON.stringify(report), native(), {
    ...expected,
    variant: "baseline",
  });
  expect(result.collectionComplete).toBe(true);
  expect(result.limitations.join(" ")).toContain("shared filesystem");
});

test("strips unexpected producer secrets, inputs, commands and raw logs", () => {
  const report = fixture();
  const raw = JSON.stringify({
    ...report,
    token: "private-value",
    commands: ["private-value"],
    turbo: [
      { ...report.turbo[0], inputs: { "private-value": "private-value" } },
    ],
    benchmarkResources: {
      ...report.benchmarkResources,
      secret: "private-value",
    },
  });
  const result = JSON.stringify(benchmarkEvidence(raw, native(), expected));
  expect(result).not.toContain("private-value");
  expect(result).not.toContain('"inputs"');
});
test("artifact streams enforce the size bound and cancel on overflow", async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8));
      controller.enqueue(new Uint8Array(9));
    },
    cancel() {
      canceled = true;
    },
  });
  await expect(boundedBenchmarkBody(stream, 16)).rejects.toThrow("size bound");
  expect(canceled).toBe(true);
  const text = "{" + '"λ":1' + "}";
  expect(await boundedBenchmarkBody(new Blob([text]).stream())).toBe(text);
});

test("an interrupted artifact stream cannot become a successful partial report", async () => {
  const controller = new AbortController();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      canceled = true;
    },
  });
  const pending = boundedBenchmarkBody(stream, 16, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(canceled).toBe(true);
});
