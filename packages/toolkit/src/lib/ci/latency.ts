import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";
import { pipelineTiming } from "./timing.ts";
import type { LatencyEvidence } from "./latency-evidence.ts";

export function pipelineKind(pipeline: WoodpeckerPipeline): string {
  const names = new Set(pipeline.workflows.map((workflow) => workflow.name));
  if (names.has("ci-noop")) return "noop";
  if (names.has("draft-preflight")) return "draft";
  if (
    names.has("maintenance-release-notes") ||
    names.has("maintenance-ci-images")
  )
    return "maintenance";
  if (
    pipeline.branch === "main" &&
    ["push", "manual"].includes(pipeline.event ?? "") &&
    ["verify", "images", "helm-push", "argocd-sync"].every((name) =>
      names.has(name),
    )
  )
    return "main";
  if (names.has("verify") && names.has("ci-complete")) {
    if (pipeline.pr_draft === true) return "legacy-draft-verification";
    if (pipeline.ref?.startsWith("refs/pull/") === true) return "ready-pr";
  }
  return "other";
}

function phaseKind(workflow: string, step: string): string {
  if (step === "clone") return "checkout";
  if (step === "bootstrap") return "bootstrap";
  if (workflow.includes("review")) return "review";
  if (workflow === "verify" || workflow === "playwright-e2e")
    return "verification";
  if (["images", "helm-push", "publish", "github-release"].includes(workflow))
    return "publication";
  if (workflow === "argocd-sync" || workflow.startsWith("tofu-"))
    return "deployment";
  return workflow === "ci-complete" ? "completion" : "other";
}

/** Nearest-rank percentiles; an empty or small sample never implies an SLO. */
export function distribution(values: readonly (number | null)[]) {
  const samples = values
    .filter((value) => value !== null)
    .toSorted((a, b) => a - b);
  const rank = (fraction: number) =>
    samples[Math.ceil(samples.length * fraction) - 1] ?? null;
  return {
    count: samples.length,
    missing: values.length - samples.length,
    p50Seconds: rank(0.5),
    p95Seconds: rank(0.95),
  };
}

export function latencyRecord(
  pipeline: WoodpeckerPipeline,
  now: number,
  evidence?: LatencyEvidence,
) {
  const timing = pipelineTiming(pipeline, now);
  const started = pipeline.workflows.flatMap((workflow) =>
    (workflow.started ?? 0) > 0 ? [workflow.started ?? 0] : [],
  );
  const queueSeconds =
    started.length === 0 || (pipeline.created ?? 0) <= 0
      ? null
      : Math.max(0, Math.min(...started) - (pipeline.created ?? 0));
  return {
    pipeline: pipeline.number,
    commit: pipeline.commit,
    event: pipeline.event ?? null,
    kind: pipelineKind(pipeline),
    status: pipeline.status,
    attempt: pipeline.rerun_count ?? 0,
    review: pipeline.workflows.some((workflow) =>
      workflow.name.includes("review"),
    )
      ? (evidence?.review.kind ?? "unknown")
      : "not-applicable",
    reviewProviders: evidence?.review.providers ?? [],
    evidence: evidence?.steps ?? [],
    elapsedSeconds: timing.elapsedSeconds,
    queueSeconds,
    withoutActiveWorkflowSeconds: timing.withoutActiveWorkflowSeconds,
    workflows: timing.workflows.map((workflow) => ({
      ...workflow,
      phases: workflow.phases.map((phase) => ({
        ...phase,
        kind: phaseKind(workflow.name, phase.name),
      })),
    })),
  };
}

export function latencyReport(
  pipelines: readonly WoodpeckerPipeline[],
  since: number,
  until: number,
  evidence: ReadonlyMap<number, LatencyEvidence> = new Map(),
) {
  const records = pipelines.map((pipeline) =>
    latencyRecord(pipeline, until, evidence.get(pipeline.number)),
  );
  // Use the slowest eligible success for duplicate heads, never the fastest retry.
  const freshHeads = Map.groupBy(
    records.filter(
      (record) =>
        record.kind === "ready-pr" &&
        record.status === "success" &&
        record.attempt === 0 &&
        record.review === "fresh" &&
        record.elapsedSeconds !== null,
    ),
    (record) => record.commit,
  );
  const measurements = records.flatMap((record) => record.evidence);
  const checkout = measurements.flatMap((entry) =>
    entry.checkout === null ? [] : [entry.checkout],
  );
  const groups = Map.groupBy(
    records,
    (record) =>
      `${record.kind}/${record.attempt === 0 ? "initial" : "rerun"}/${record.status}/review-${record.review}`,
  );
  return {
    schemaVersion: 1,
    since: new Date(since * 1000).toISOString(),
    until: new Date(until * 1000).toISOString(),
    count: records.length,
    freshReadyHeads: {
      requiredSamples: 30,
      enoughSamples: freshHeads.size >= 30,
      ...distribution(
        [...freshHeads.values()].map((heads) =>
          Math.max(...heads.map((head) => head.elapsedSeconds ?? 0)),
        ),
      ),
    },
    logEvidence: {
      requestedSteps: measurements.length,
      unavailableSteps: measurements.filter((entry) => !entry.available).length,
      checkout: ["hit", "miss"].map((cache) => {
        const samples = checkout.filter((entry) => entry.cache === cache);
        return {
          cache,
          total: distribution(samples.map((entry) => entry.totalMs / 1000)),
          download: distribution(
            samples.map((entry) => entry.downloadMs / 1000),
          ),
          materialization: distribution(
            samples.map((entry) => entry.materializationMs / 1000),
          ),
          downloadedObjectBytes: samples.reduce(
            (sum, entry) => sum + entry.downloadedObjectBytes,
            0,
          ),
        };
      }),
      toolchain: [
        ...Map.groupBy(
          measurements.flatMap((entry) => entry.bootstrap),
          (entry) => entry.scope,
        ),
      ].map(([scope, samples]) => ({
        scope,
        ...distribution(samples.map((entry) => entry.elapsedSeconds)),
      })),
    },
    cohorts: [...groups].map(([cohort, entries]) => ({
      cohort,
      count: entries.length,
      // Only successful, finished pipelines provide latency SLO samples.
      latency: distribution(
        entries
          .filter((entry) => entry.status === "success")
          .map((entry) => entry.elapsedSeconds),
      ),
      initialQueue: distribution(entries.map((entry) => entry.queueSeconds)),
      phases: [
        ...Map.groupBy(
          entries.flatMap((entry) =>
            entry.workflows.flatMap((workflow) => workflow.phases),
          ),
          (phase) => phase.kind,
        ),
      ].map(([kind, phases]) => ({
        kind,
        ...distribution(
          phases
            .filter((phase) => phase.state === "success")
            .map((phase) => phase.elapsedSeconds),
        ),
      })),
    })),
    records,
    limitations: [
      "History reflects each pipeline's latest attempt, not superseded attempts. Reruns have separate cohorts.",
      "Review freshness uses final structured gate observations for the exact head: fresh completion during this pipeline, reused completion before it, or a quota exemption. Missing evidence stays unknown. Provider details retain partial quota coverage; one passing provider can satisfy the existing gate.",
      "Phase samples are individual steps, not additive wall time. Native timings include admission and pod startup. Initial queue is only the delay to the first workflow.",
      "Log reads are limited to four concurrent requests and 8 MiB per step. Successful clone, review and selected verification/maintenance command logs provide evidence; missing, malformed or oversized logs stay unavailable. Toolchain measurements exclude dependency installs and overlap command time. Stored Git object bytes are not network bytes.",
      "Canceled, failed, pending, draft, noop, maintenance and successful verification cohorts remain separate. Fewer than 30 fresh ready heads cannot establish the target p95.",
    ],
  };
}

export function formatLatency(
  report: ReturnType<typeof latencyReport>,
): string {
  return [
    `${String(report.count)} pipelines: ${report.since} — ${report.until}`,
    ...report.cohorts.map(
      (group) =>
        `${group.cohort}: ${String(group.count)} runs; successful latency n=${String(group.latency.count)}, p50=${String(group.latency.p50Seconds)}s, p95=${String(group.latency.p95Seconds)}s`,
    ),
    `Fresh ready heads: ${String(report.freshReadyHeads.count)}/${String(report.freshReadyHeads.requiredSamples)} minimum; enough samples=${String(report.freshReadyHeads.enoughSamples)}`,
    ...report.limitations,
  ].join("\n");
}
