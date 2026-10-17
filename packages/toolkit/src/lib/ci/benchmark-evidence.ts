import { createHash } from "node:crypto";
import { z } from "zod";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

const Counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Filesystem = z.object({
  path: z.enum(["/woodpecker/tmp", "/woodpecker/gradle"]),
  filesystem: z.enum(["tmpfs", "shared"]),
  capacityBytes: Counter.positive(),
  usedBytes: Counter,
  availableBytes: Counter,
});
const Resources = z.object({
  version: z.literal(1),
  variant: z.enum(["baseline", "candidate"]),
  intervalMs: z.literal(10_000),
  collectionFailed: z.boolean(),
  samples: z
    .array(
      z.object({
        at: Counter,
        memory: z.object({
          currentBytes: Counter,
          peakBytes: Counter,
          limitBytes: Counter.positive(),
          limitHits: Counter,
          oomEvents: Counter,
          oomKills: Counter,
        }),
        filesystems: z.array(Filesystem).length(2),
      }),
    )
    .min(1)
    .max(721),
});
const Report = z.object({
  version: z.literal(1),
  pipeline: z.string().regex(/^\d+$/u),
  commit: z.string().regex(/^[a-f\d]{40}$/u),
  workflow: z.literal("verify"),
  startedAt: Counter,
  finishedAt: Counter,
  exitCode: z.number().int(),
  collectionFailed: z.boolean(),
  benchmarkResources: Resources,
  turbo: z.array(
    z.object({
      execution: z.object({
        success: Counter,
        failed: Counter,
        cached: Counter,
        attempted: Counter,
      }),
    }),
  ),
});

type ReportValue = z.infer<typeof Report>;
type Sample = ReportValue["benchmarkResources"]["samples"][number];
type Volume = z.infer<typeof Filesystem> & {
  maxObservedUsedBytes: number;
  minObservedAvailableBytes: number;
};
type Expected = { head: string; variant: "baseline" | "candidate" };

function assertIdentity(
  report: ReportValue,
  pipeline: WoodpeckerPipeline,
  expected: Expected,
) {
  const workflow = pipeline.workflows[0];
  if (
    pipeline.event !== "manual" ||
    pipeline.branch?.startsWith("ci-canary/") !== true ||
    pipeline.workflows.length !== 1 ||
    workflow?.name !== "verify" ||
    pipeline.commit !== expected.head ||
    report.commit !== expected.head ||
    report.pipeline !== String(pipeline.number) ||
    report.benchmarkResources.variant !== expected.variant
  )
    throw new Error("Benchmark source, pipeline, workflow or variant mismatch");
  if (pipeline.rerun_count !== 0)
    throw new Error(
      "Benchmark artifact has no attempt identity; reruns cannot be accepted",
    );
  if (!["success", "failure", "error", "killed"].includes(pipeline.status))
    throw new Error("Benchmark pipeline has not reached a terminal state");
  return workflow;
}

function assertLifetime(
  report: ReportValue,
  workflow: WoodpeckerPipeline["workflows"][number],
) {
  if (report.finishedAt < report.startedAt)
    throw new Error("Benchmark command timestamps are reversed");
  if (
    workflow.started === undefined ||
    workflow.finished === undefined ||
    workflow.started <= 0 ||
    workflow.finished <= 0 ||
    report.startedAt < workflow.started * 1000 ||
    report.finishedAt > (workflow.finished + 1) * 1000
  )
    throw new Error(
      "Benchmark command is outside the native workflow lifetime",
    );
}

function memoryIssues(sample: Sample, previous: Sample | undefined): string[] {
  const issues: string[] = [];
  if (
    sample.memory.currentBytes > sample.memory.peakBytes ||
    sample.memory.peakBytes > sample.memory.limitBytes
  )
    issues.push("Memory counters exceed their peak or limit");
  if (
    previous !== undefined &&
    (sample.at < previous.at ||
      sample.memory.limitBytes !== previous.memory.limitBytes ||
      (["peakBytes", "limitHits", "oomEvents", "oomKills"] as const).some(
        (key) => sample.memory[key] < previous.memory[key],
      ))
  )
    issues.push("Resource identity, ordering or cumulative counters changed");
  return issues;
}

function filesystemIssues(
  fs: z.infer<typeof Filesystem>,
  before: Volume | undefined,
  variant: Expected["variant"],
): string[] {
  const issues: string[] = [];
  if (
    fs.usedBytes > fs.capacityBytes ||
    fs.availableBytes > fs.capacityBytes ||
    fs.usedBytes + fs.availableBytes > fs.capacityBytes
  )
    issues.push("Filesystem counters exceed capacity");
  const capacity =
    fs.path === "/woodpecker/tmp" ? 8 * 1024 ** 3 : 4 * 1024 ** 3;
  if (
    variant === "candidate" &&
    (fs.filesystem !== "tmpfs" || fs.capacityBytes !== capacity)
  )
    issues.push("Candidate scratch filesystem type or capacity mismatch");
  if (variant === "baseline" && fs.filesystem !== "shared")
    issues.push("Baseline unexpectedly uses tmpfs scratch");
  if (
    before !== undefined &&
    (before.filesystem !== fs.filesystem ||
      before.capacityBytes !== fs.capacityBytes)
  )
    issues.push("Scratch filesystem identity changed");
  return issues;
}

function resourceCoverage(report: ReportValue, maxGapMs: number) {
  const first = report.benchmarkResources.samples[0];
  const last = report.benchmarkResources.samples.at(-1);
  if (first === undefined || last === undefined)
    throw new Error("Missing resource samples");
  const firstGapMs = first.at - report.startedAt;
  const finalEndpointSkewMs = last.at - report.finishedAt;
  const complete =
    firstGapMs <= 0 &&
    firstGapMs >= -30_000 &&
    finalEndpointSkewMs >= 0 &&
    finalEndpointSkewMs <= 30_000 &&
    maxGapMs <= 30_000;
  return {
    complete,
    last,
    coverage: { firstGapMs, finalEndpointSkewMs, maxGapMs },
  };
}

function summarizeResources(report: ReportValue) {
  const resources = report.benchmarkResources;
  const issues: string[] = [];
  if (report.collectionFailed || resources.collectionFailed)
    issues.push("Producer reported incomplete collection");
  let previous: Sample | undefined;
  let maxGapMs = 0;
  let peakBytes = 0;
  const volumes = new Map<string, Volume>();
  for (const sample of resources.samples) {
    const expectedLimitBytes =
      (resources.variant === "candidate" ? 36 : 24) * 1024 ** 3;
    if (sample.memory.limitBytes !== expectedLimitBytes)
      issues.push("Benchmark memory limit differs from its declared variant");
    if (
      sample.at < report.startedAt - 30_000 ||
      sample.at > report.finishedAt + 30_000
    )
      issues.push("Resource sample lies outside command endpoints");
    issues.push(...memoryIssues(sample, previous));
    maxGapMs = Math.max(maxGapMs, sample.at - (previous?.at ?? sample.at));
    peakBytes = Math.max(peakBytes, sample.memory.peakBytes);
    if (new Set(sample.filesystems.map((fs) => fs.path)).size !== 2)
      issues.push("Scratch volume paths are missing or duplicated");
    for (const fs of sample.filesystems) {
      const before = volumes.get(fs.path);
      issues.push(...filesystemIssues(fs, before, resources.variant));
      volumes.set(fs.path, {
        ...fs,
        maxObservedUsedBytes: Math.max(
          before?.maxObservedUsedBytes ?? 0,
          fs.usedBytes,
        ),
        minObservedAvailableBytes: Math.min(
          before?.minObservedAvailableBytes ?? fs.availableBytes,
          fs.availableBytes,
        ),
      });
    }
    previous = sample;
  }
  const { complete, last, coverage } = resourceCoverage(report, maxGapMs);
  if (!complete)
    issues.push("Resource collection does not cover the command continuously");
  return {
    issues,
    volumes,
    peakBytes,
    last,
    coverage,
  };
}

/** A narrow consumer contract: strip task inputs, environment, commands and logs. */
export function benchmarkEvidence(
  raw: string,
  pipeline: WoodpeckerPipeline,
  expected: Expected,
) {
  const report = Report.parse(JSON.parse(raw));
  const workflow = assertIdentity(report, pipeline, expected);
  assertLifetime(report, workflow);
  const { issues, volumes, peakBytes, last, coverage } =
    summarizeResources(report);
  const totals = report.turbo.reduce(
    (sum, run) => ({
      success: sum.success + run.execution.success,
      failed: sum.failed + run.execution.failed,
      cached: sum.cached + run.execution.cached,
      attempted: sum.attempted + run.execution.attempted,
    }),
    { success: 0, failed: 0, cached: 0, attempted: 0 },
  );
  if (totals.success + totals.failed + totals.cached !== totals.attempted)
    issues.push("Turbo task counts are inconsistent");
  const collectionComplete = issues.length === 0;
  const resourceHealthy =
    collectionComplete &&
    last.memory.limitHits === 0 &&
    last.memory.oomEvents === 0 &&
    last.memory.oomKills === 0 &&
    [...volumes.values()].every((fs) => fs.minObservedAvailableBytes > 0);
  const taskSuccess =
    pipeline.status === "success" &&
    workflow.state === "success" &&
    report.exitCode === 0 &&
    totals.failed === 0 &&
    totals.attempted > 0;
  return {
    version: 1,
    pipeline: pipeline.number,
    source: report.commit,
    branch: pipeline.branch,
    variant: report.benchmarkResources.variant,
    artifact: `s3://ci-handoff/${report.pipeline}/diagnostics-verify.json`,
    artifactSha256: createHash("sha256").update(raw).digest("hex"),
    command: {
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      elapsedMs: report.finishedAt - report.startedAt,
      exitCode: report.exitCode,
    },
    counts: totals,
    collectionComplete,
    resourceHealthy,
    taskSuccess,
    physicalQualification: false,
    productionQualified: false,
    issues: [...new Set(issues)],
    coverage,
    peakBytes,
    volumes: [...volumes.values()].map(
      ({
        path,
        filesystem,
        capacityBytes,
        maxObservedUsedBytes,
        minObservedAvailableBytes,
      }) => ({
        path,
        filesystem,
        capacityBytes,
        maxObservedUsedBytes,
        minObservedAvailableBytes,
      }),
    ),
    resources: report.benchmarkResources,
    limitations: [
      "Filesystem maxima are sampled observations, not guaranteed transient peaks. Baseline filesystem capacity and usage describe the shared filesystem, not directory size.",
      "This report does not verify pod identity/restarts, quiet windows, device writes, setup/publication/settling, or paired performance. It cannot qualify production.",
    ],
  };
}
