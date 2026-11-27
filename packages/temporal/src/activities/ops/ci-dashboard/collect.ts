import type { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import type {
  CiDashboardSample,
  CiRun,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import {
  activePipeline,
  pipelineWorkflows,
  queueOnlyWorkflows,
  readPipelineDetails,
  requiredWorkflows,
  summarizePipeline,
  type PipelineClient,
  type PipelineSummary,
  type Queue,
  type SourceFailure,
} from "./pipelines.ts";

const ACTIVE_LIMIT = 40;
const RECENT_LIMIT = 20;
const PAGE_SIZE = 50;
const KUEUE_PENDING =
  'kueue_pending_workloads{cluster_queue=~"woodpecker|woodpecker-gates"}';
const ADMISSION_QUERY = `sum by (cluster_queue) (max by (cluster_queue, status) (${KUEUE_PENDING} and (time() - timestamp(${KUEUE_PENDING}) < 120)))`;

function tasksByPipeline(
  tasks: readonly Queue["tasks"][number][],
): Map<number, Queue["tasks"]> {
  const result = new Map<number, Queue["tasks"]>();
  for (const task of tasks) {
    if (task.pipelineNumber === null) continue;
    const rows = result.get(task.pipelineNumber) ?? [];
    rows.push(task);
    result.set(task.pipelineNumber, rows);
  }
  return result;
}

function candidatePriority(
  tasks: Queue["tasks"] | undefined,
  summary: PipelineSummary | undefined,
): number {
  if (tasks === undefined) {
    if (summary?.status === "running") return 0;
    return summary?.status === "pending" ? 1 : 3;
  }
  if (tasks.some((task) => task.state === "running")) return 0;
  return tasks.some((task) => task.state === "ready") ? 1 : 2;
}

async function readCiSource<T>(
  source: string,
  read: () => Promise<T>,
  onFailure: SourceFailure,
): Promise<T | null> {
  try {
    return await read();
  } catch (error: unknown) {
    onFailure(source, error);
    return null;
  }
}

export function queueSample(
  queue: Queue,
  sampledAt: string,
): NonNullable<CiDashboardSample["queue"]> {
  const queued = queue.tasks.filter((task) => task.state !== "running");
  let oldest: string | null = null;
  for (const task of queued) {
    if (
      task.pipelineCreatedAt !== null &&
      (oldest === null || task.pipelineCreatedAt < oldest)
    ) {
      oldest = task.pipelineCreatedAt;
    }
  }
  return {
    sampledAt,
    paused: queue.paused,
    ready: queue.ready,
    waitingOnDependencies: queue.waitingOnDependencies,
    running: queue.running,
    oldestQueuedPipelineCreatedAt: oldest,
  };
}

async function admissionSample(
  prometheus: Pick<PrometheusClient, "query">,
  sampledAt: string,
  signal: AbortSignal,
): Promise<CiDashboardSample["admission"]> {
  const samples = await prometheus.query(ADMISSION_QUERY, signal);
  const read = (queue: string): number | null => {
    const value = samples.find(
      (sample) => sample.metric["cluster_queue"] === queue,
    )?.value;
    return value !== undefined && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  };
  const compute = read("woodpecker");
  const gates = read("woodpecker-gates");
  return compute === null && gates === null
    ? null
    : { sampledAt, compute, gates };
}

async function recentPipelines(
  client: PipelineClient,
  signal: AbortSignal,
): Promise<PipelineSummary[]> {
  const summaries = new Map<number, PipelineSummary>();
  for (let page = 1; page <= 3; page++) {
    const rows = await client.pipelines({ page, perPage: PAGE_SIZE, signal });
    for (const row of rows) {
      const existing = summaries.get(row.number);
      if (existing === undefined || existing.attempt < row.attempt) {
        summaries.set(row.number, row);
      }
    }
    // Woodpecker pages by pipeline number, so a lower-numbered run can
    // still finish after every run on the first page.
    if (rows.length < PAGE_SIZE) break;
  }
  return [...summaries.values()];
}

async function jobsSample(input: {
  client: PipelineClient;
  repoId: number;
  queue: Queue | null;
  summaries: PipelineSummary[] | null;
  sampledAt: string;
  signal: AbortSignal;
  onFailure: SourceFailure;
}): Promise<CiDashboardSample["jobs"]> {
  const { client, repoId, queue, summaries, sampledAt, signal, onFailure } =
    input;
  if (queue === null && summaries === null) return null;

  const tasks = (queue?.tasks ?? []).filter((task) => task.repoId === repoId);
  const activeSummaries = new Map(
    (summaries ?? [])
      .filter((pipeline) => activePipeline(pipeline.status))
      .map((pipeline) => [pipeline.number, pipeline]),
  );
  const groupedTasks = tasksByPipeline(tasks);
  const statuses =
    queue === null || groupedTasks.size > ACTIVE_LIMIT
      ? (["blocked", "pending", "running"] as const)
      : (["blocked"] as const);
  const extra = await Promise.all(
    statuses.map((status) =>
      readCiSource(
        "woodpecker_active_pipelines",
        () => client.pipelines({ page: 1, perPage: PAGE_SIZE, status, signal }),
        onFailure,
      ),
    ),
  );
  for (const row of extra.flatMap((rows) => rows ?? [])) {
    activeSummaries.set(row.number, row);
  }

  const candidates = [
    ...new Set([...activeSummaries.keys(), ...groupedTasks.keys()]),
  ].sort(
    (left, right) =>
      candidatePriority(groupedTasks.get(left), activeSummaries.get(left)) -
        candidatePriority(
          groupedTasks.get(right),
          activeSummaries.get(right),
        ) || left - right,
  );
  const selected = candidates.slice(0, ACTIVE_LIMIT);
  const details = await readPipelineDetails(
    selected,
    async (number) => {
      const detail = await client.pipeline(number, signal);
      const graph = await requiredWorkflows(client, detail, {
        signal,
        onFailure,
        historical: false,
      });
      return {
        ...summarizePipeline(detail),
        requiredWorkflows: graph.names,
        workflows: pipelineWorkflows(
          detail,
          groupedTasks.get(number) ?? [],
          queue?.paused ?? false,
        ),
      };
    },
    onFailure,
    signal,
  );
  const indexed = new Map(details.runs.map((run) => [run.pipeline, run]));
  const active = candidates.flatMap((number) => {
    const detail = indexed.get(number);
    if (detail !== undefined) {
      return activePipeline(detail.state) ? [detail] : [];
    }
    const summary = activeSummaries.get(number);
    return summary === undefined
      ? []
      : [
          {
            ...summarizePipeline(summary),
            workflows: queueOnlyWorkflows(
              summary,
              groupedTasks.get(number) ?? [],
              queue?.paused ?? false,
            ),
          },
        ];
  });

  const recent = new Map<number, CiRun>();
  for (const summary of summaries ?? []) {
    if (!activePipeline(summary.status)) {
      recent.set(summary.number, summarizePipeline(summary));
    }
  }
  for (const detail of details.runs) {
    if (activePipeline(detail.state)) recent.delete(detail.pipeline);
    else recent.set(detail.pipeline, detail);
  }
  return {
    sampledAt,
    partial:
      queue === null ||
      summaries === null ||
      details.partial ||
      selected.length < candidates.length ||
      extra.some((rows) => rows === null || rows.length === PAGE_SIZE) ||
      tasks.some((task) => task.pipelineNumber === null),
    active,
    recent: [...recent.values()]
      .sort(
        (left, right) =>
          (right.finishedAt ?? right.createdAt).localeCompare(
            left.finishedAt ?? left.createdAt,
          ) || right.pipeline - left.pipeline,
      )
      .slice(0, RECENT_LIMIT),
  };
}

export async function collectCiDashboard(input: {
  client: PipelineClient;
  prometheus: Pick<PrometheusClient, "query">;
  repoId: number;
  now: Date;
  signal: AbortSignal;
  onFailure: SourceFailure;
}): Promise<CiDashboardSample> {
  const { client, prometheus, repoId, now, signal, onFailure } = input;
  const sampledAt = now.toISOString();
  const [queue, admission, summaries] = await Promise.all([
    readCiSource("woodpecker_queue", () => client.queue(signal), onFailure),
    readCiSource(
      "kueue_admission",
      () => admissionSample(prometheus, sampledAt, signal),
      onFailure,
    ),
    readCiSource(
      "woodpecker_recent_pipelines",
      () => recentPipelines(client, signal),
      onFailure,
    ),
  ]);
  return {
    sampledAt,
    queue: queue === null ? null : queueSample(queue, sampledAt),
    admission,
    jobs: await jobsSample({
      client,
      repoId,
      queue,
      summaries,
      sampledAt,
      signal,
      onFailure,
    }),
  };
}
