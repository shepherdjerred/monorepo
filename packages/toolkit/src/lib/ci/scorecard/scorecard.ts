import { pipelineHistory } from "#lib/ci/history.ts";
import { latencyReport } from "#lib/ci/latency.ts";
import {
  metric,
  section,
  woodpeckerQueue,
  type LoadSection,
  type Metric,
} from "#lib/ci/load.ts";
import type {
  WoodpeckerConfig,
  WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";

/** A pipeline whose status is a verdict; killed and canceled ones are not. */
const VERDICT_STATUSES = new Set(["success", "failure", "error"]);
const GB = 1e9;

/** Nearest-rank percentile, as `distribution` in latency.ts computes. */
function nearestRank(sorted: readonly number[], fraction: number) {
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
}

export type Spread = {
  readonly count: number;
  readonly p50Seconds: number | null;
  readonly p90Seconds: number | null;
};

export function spread(values: readonly (number | null)[]): Spread {
  const sorted = values
    .filter((value) => value !== null)
    .toSorted((left, right) => left - right);
  return {
    count: sorted.length,
    p50Seconds: nearestRank(sorted, 0.5),
    p90Seconds: nearestRank(sorted, 0.9),
  };
}

/** One `verify` step pod: how long it took to start after its creation. */
export type VerifyPod = {
  readonly pod: string;
  readonly commit: string;
  readonly createdAt: number;
  /**
   * Pod created to container started: Kueue admission, scheduling and image
   * pull. Woodpecker marks the step started when it creates the pod, so the
   * API cannot see this wait.
   */
  readonly gateSeconds: number;
};

function podLabel(sample: Metric, label: string): string {
  const value = sample.metric[label];
  if (value === undefined)
    throw new Error(`Verify pod sample lacks the ${label} label`);
  return value;
}

/** Join the gate-seconds and creation-time samples of verify step pods. */
export function verifyPods(
  gates: readonly Metric[],
  created: readonly Metric[],
): VerifyPod[] {
  const createdAt = new Map(
    created.map((sample) => [podLabel(sample, "pod"), Number(sample.value[1])]),
  );
  return gates.flatMap((sample) => {
    const pod = podLabel(sample, "pod");
    const at = createdAt.get(pod);
    return at === undefined
      ? []
      : [
          {
            pod,
            commit: podLabel(sample, "label_ci_sjer_red_commit"),
            createdAt: at,
            gateSeconds: Number(sample.value[1]),
          },
        ];
  });
}

export type PipelineScorecard = {
  readonly readyPr: {
    /** Ready-PR pipelines with a verdict (success, failure or error). */
    readonly finished: number;
    readonly failed: number;
    readonly failedShare: number | null;
    readonly endToEnd: Spread;
    /** Pipeline created to the verify workflow starting on an agent. */
    readonly agentWait: Spread;
    /** Verify's pod created to its container started. */
    readonly kueueGate: Spread;
    /** The rest of the pipeline: end to end less agent wait and gate. */
    readonly run: Spread;
  };
  readonly main: { readonly finished: number; readonly endToEnd: Spread };
};

function verifyPodsOf(
  pipeline: WoodpeckerPipeline,
  pods: readonly VerifyPod[],
  now: number,
): VerifyPod[] {
  const from = pipeline.created ?? 0;
  const to =
    pipeline.finished === undefined || pipeline.finished === 0
      ? now
      : pipeline.finished;
  return pods.filter(
    (pod) =>
      pod.commit === pipeline.commit &&
      pod.createdAt >= from - 5 &&
      pod.createdAt <= to,
  );
}

/** Ready-PR and main-push latency, and the ready-PR failure share. */
export function pipelineScorecard(
  pipelines: readonly WoodpeckerPipeline[],
  pods: readonly VerifyPod[],
  since: number,
  until: number,
): PipelineScorecard {
  const byNumber = new Map(
    pipelines.map((pipeline) => [pipeline.number, pipeline]),
  );
  // The report's records classify pipelines and time workflows; the per-step
  // log reads that `timings` adds are separate and are not made here.
  const { records } = latencyReport(pipelines, since, until);
  const verdicts = records.filter((record) =>
    VERDICT_STATUSES.has(record.status),
  );
  const ready = verdicts.filter((record) => record.kind === "ready-pr");
  const waits = ready.map((record) => {
    const pipeline = byNumber.get(record.pipeline);
    const started = record.workflows.find(
      (workflow) => workflow.name === "verify",
    )?.startDelaySeconds;
    const matched =
      pipeline === undefined ? [] : verifyPodsOf(pipeline, pods, until);
    const agent = started ?? null;
    const gate =
      matched.length === 0
        ? null
        : matched.reduce((sum, pod) => sum + pod.gateSeconds, 0);
    const elapsed = record.elapsedSeconds;
    return {
      elapsed,
      agent,
      gate,
      run:
        elapsed === null || agent === null || gate === null
          ? null
          : Math.max(0, elapsed - agent - gate),
    };
  });
  const failed = ready.filter((record) => record.status !== "success").length;
  const main = verdicts.filter(
    (record) => record.kind === "main" && record.event === "push",
  );
  return {
    readyPr: {
      finished: ready.length,
      failed,
      failedShare: ready.length === 0 ? null : failed / ready.length,
      endToEnd: spread(waits.map((wait) => wait.elapsed)),
      agentWait: spread(waits.map((wait) => wait.agent)),
      kueueGate: spread(waits.map((wait) => wait.gate)),
      run: spread(waits.map((wait) => wait.run)),
    },
    main: {
      finished: main.length,
      endToEnd: spread(main.map((record) => record.elapsedSeconds)),
    },
  };
}

export const WRITERS = [
  "workspaces",
  "buildkit",
  "delivery",
  "caches",
] as const;
export type Writer = (typeof WRITERS)[number];
/** Gigabytes per day each writer may put on the CI pool. */
export const WRITER_BUDGET_GB: Readonly<Record<Writer, number>> = {
  workspaces: 250,
  buildkit: 100,
  delivery: 50,
  caches: 70,
};
export const TOTAL_BUDGET_GB = 500;
const CI_WORKSPACE_STORAGE_CLASS = "ci-workspace";

export function writerOf(namespace: string, storageClass: string): Writer {
  if (storageClass === CI_WORKSPACE_STORAGE_CLASS) return "workspaces";
  if (namespace === "buildkitd") return "buildkit";
  return namespace.startsWith("delivery-") ? "delivery" : "caches";
}

// The CI node's pool drive, as declared in rules/storage/nvme.ts.
const CI_POOL = 'node="liskov",zpool="zfspv-pool-nvme"';
const CI_DATASETS = 'node="liskov",dataset=~"zfspv-pool-nvme/pvc-.*"';
const CLAIMS =
  'max by (volumename, namespace, storageclass) (last_over_time(kube_persistentvolumeclaim_info{volumename!=""}[24h]))';

/**
 * Logical bytes written to each claim's dataset in 24h, by claim namespace and
 * class. A workspace dataset lives for minutes and its counter starts at zero,
 * so its largest scraped value is its total (as `ciWorkspaceWrites` in
 * nvme.ts does); increase() would drop the bytes before the first scrape. A
 * long-lived claim's counter spans its whole life, so only increase() isolates
 * the last 24h.
 */
function claimWrites(counterWindow: "max_over_time" | "increase"): string {
  return `sum by (namespace, storageclass) (${CLAIMS} * on(volumename) group_left() label_replace(max by (dataset) (${counterWindow}(node_zfs_zpool_dataset_nwritten{${CI_DATASETS}}[24h])), "volumename", "$1", "dataset", "[^/]+/(.+)"))`;
}

export type WriterRow = {
  readonly writer: Writer;
  readonly gigabytes: number;
  readonly budgetGigabytes: number;
  readonly overBudget: boolean;
};

export type WritesScorecard = {
  readonly windowHours: 24;
  readonly writers: WriterRow[];
  readonly totalGigabytes: number;
  readonly totalBudgetGigabytes: number;
  readonly overTotalBudget: boolean;
  /** The pool drive's physical writes, when its recording rule has a sample. */
  readonly poolPhysicalGigabytes: number | null;
};

/** Combine workspace (max_over_time) and long-lived (increase) claim samples. */
export function writesScorecard(
  workspaceSamples: readonly Metric[],
  longLivedSamples: readonly Metric[],
  poolPhysicalBytes: number | null,
): WritesScorecard {
  const bytes = new Map<Writer, number>(WRITERS.map((writer) => [writer, 0]));
  const add = (sample: Metric, keep: (writer: Writer) => boolean) => {
    const writer = writerOf(
      sample.metric["namespace"] ?? "",
      sample.metric["storageclass"] ?? "",
    );
    if (keep(writer))
      bytes.set(writer, (bytes.get(writer) ?? 0) + Number(sample.value[1]));
  };
  for (const sample of workspaceSamples)
    add(sample, (writer) => writer === "workspaces");
  for (const sample of longLivedSamples)
    add(sample, (writer) => writer !== "workspaces");
  const writers = WRITERS.map((writer) => {
    const gigabytes = (bytes.get(writer) ?? 0) / GB;
    return {
      writer,
      gigabytes,
      budgetGigabytes: WRITER_BUDGET_GB[writer],
      overBudget: gigabytes > WRITER_BUDGET_GB[writer],
    };
  });
  const totalGigabytes = writers.reduce((sum, row) => sum + row.gigabytes, 0);
  return {
    windowHours: 24,
    writers,
    totalGigabytes,
    totalBudgetGigabytes: TOTAL_BUDGET_GB,
    overTotalBudget: totalGigabytes > TOTAL_BUDGET_GB,
    poolPhysicalGigabytes:
      poolPhysicalBytes === null ? null : poolPhysicalBytes / GB,
  };
}

async function poolWrites(signal?: AbortSignal): Promise<WritesScorecard> {
  const [workspaces, longLived, physical] = await Promise.all([
    metric(claimWrites("max_over_time"), signal),
    metric(claimWrites("increase"), signal),
    // The recording rule is an extra; the claim sums above are the verdict.
    metric(
      `zfs_pool:physical_written_bytes:increase24h{${CI_POOL}}`,
      signal,
    ).catch(() => null),
  ]);
  const sample = physical?.[0];
  return writesScorecard(
    workspaces,
    longLived,
    sample === undefined ? null : Number(sample.value[1]),
  );
}

const VERIFY_PODS =
  'kube_pod_labels{namespace="woodpecker-ci", label_ci_sjer_red_step_key="verify"}';

function windowMinutes(since: number, until: number): string {
  return `${String(Math.ceil((until - since) / 60))}m`;
}

async function verifyPodSamples(
  since: number,
  until: number,
  signal?: AbortSignal,
): Promise<VerifyPod[]> {
  const window = `[${windowMinutes(since, until)}:5m]`;
  const [gates, created] = await Promise.all([
    metric(
      `max_over_time(((kube_pod_container_state_started{namespace="woodpecker-ci"} - on (namespace, pod) group_left () kube_pod_created{namespace="woodpecker-ci"}) * on (namespace, pod) group_left (label_ci_sjer_red_commit) ${VERIFY_PODS})${window})`,
      signal,
    ),
    metric(
      `max_over_time((kube_pod_created{namespace="woodpecker-ci"} * on (namespace, pod) group_left (label_ci_sjer_red_commit) ${VERIFY_PODS})${window})`,
      signal,
    ),
  ]);
  return verifyPods(gates, created);
}

export type Scorecard = {
  readonly schemaVersion: 1;
  readonly window: { readonly since: string; readonly until: string };
  readonly pipelines: number;
  readonly latency: LoadSection<
    PipelineScorecard & {
      /** Why no pod start times joined the pipelines; null when they did. */
      readonly gateError: string | null;
    }
  >;
  readonly queue: LoadSection<{
    readonly pending: number;
    readonly running: number;
    readonly waitingOnDependencies: number;
    readonly workers: number;
  }>;
  readonly writes: LoadSection<WritesScorecard>;
};

/**
 * One view of the CI program's targets. Each section reads independently, so
 * an unavailable source is reported in place and the others still print.
 */
export async function ciScorecard(
  config: WoodpeckerConfig,
  since: number,
  until: number,
  signal?: AbortSignal,
): Promise<Scorecard> {
  const secrets = [config.token];
  const pipelines = await pipelineHistory(config, since, until, signal);
  const [latency, queue, writes] = await Promise.all([
    section(async () => {
      // Pipeline timings stand without the pod metrics; only the gate split needs them.
      let pods: VerifyPod[] = [];
      let gateError: string | null = null;
      try {
        pods = await verifyPodSamples(since, until, signal);
      } catch (error) {
        gateError = error instanceof Error ? error.message : String(error);
      }
      return {
        ...pipelineScorecard(pipelines, pods, since, until),
        gateError,
      };
    }, secrets),
    section(async () => {
      const info = await woodpeckerQueue(config, signal);
      return {
        pending: info.stats.pending_count,
        running: info.stats.running_count,
        waitingOnDependencies: info.stats.waiting_on_deps_count,
        workers: info.stats.worker_count,
      };
    }, secrets),
    section(() => poolWrites(signal), secrets),
  ]);
  return {
    schemaVersion: 1,
    window: {
      since: new Date(since * 1000).toISOString(),
      until: new Date(until * 1000).toISOString(),
    },
    pipelines: pipelines.length,
    latency,
    queue,
    writes,
  };
}

function minutes(seconds: number | null): string {
  return seconds === null ? "-" : `${(seconds / 60).toFixed(1)}m`;
}

function spreadLine(label: string, value: Spread): string {
  return `  ${label.padEnd(14)} p50 ${minutes(value.p50Seconds).padStart(7)}  p90 ${minutes(value.p90Seconds).padStart(7)}  (n=${String(value.count)})`;
}

export function formatScorecard(report: Scorecard): string {
  const lines = [
    `CI scorecard: ${report.window.since} — ${report.window.until} (${String(report.pipelines)} pipelines)`,
    "",
  ];
  if (report.latency.available) {
    const { readyPr, main } = report.latency.data;
    lines.push(
      `Ready-PR pipelines with a verdict (success, failure, error): ${String(readyPr.finished)}`,
      spreadLine("end to end", readyPr.endToEnd),
      spreadLine("  agent wait", readyPr.agentWait),
      spreadLine("  Kueue gate", readyPr.kueueGate),
      ...(report.latency.data.gateError === null
        ? []
        : [`    gate unavailable: ${report.latency.data.gateError}`]),
      spreadLine("  run", readyPr.run),
      `  failed         ${
        readyPr.failedShare === null
          ? "-"
          : `${(readyPr.failedShare * 100).toFixed(0)}%`
      } (${String(readyPr.failed)} of ${String(readyPr.finished)})`,
      "",
      `Main pushes with a verdict: ${String(main.finished)}`,
      spreadLine("end to end", main.endToEnd),
    );
  } else lines.push(`Latency unavailable: ${report.latency.error}`);
  lines.push("");
  lines.push(
    report.queue.available
      ? `Woodpecker now: ${String(report.queue.data.pending)} pending, ${String(report.queue.data.running)} running, ${String(report.queue.data.waitingOnDependencies)} waiting on dependencies; ${String(report.queue.data.workers)} worker(s)`
      : `Woodpecker queue unavailable: ${report.queue.error}`,
  );
  lines.push("");
  if (report.writes.available) {
    const writes = report.writes.data;
    lines.push(
      `CI pool writes, last ${String(writes.windowHours)}h (logical GB written to claims / budget per day):`,
      ...writes.writers.map(
        (row) =>
          `  ${row.writer.padEnd(11)} ${row.gigabytes.toFixed(0).padStart(6)} / ${String(row.budgetGigabytes).padStart(3)}${row.overBudget ? "  OVER" : ""}`,
      ),
      `  ${"total".padEnd(11)} ${writes.totalGigabytes.toFixed(0).padStart(6)} / ${String(writes.totalBudgetGigabytes).padStart(3)}${writes.overTotalBudget ? "  OVER" : ""}`,
      writes.poolPhysicalGigabytes === null
        ? "  pool physical writes: unavailable"
        : `  pool physical writes: ${writes.poolPhysicalGigabytes.toFixed(0)} GB`,
    );
  } else lines.push(`Pool writes unavailable: ${report.writes.error}`);
  return lines.join("\n");
}
