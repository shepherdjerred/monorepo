import {
  CI_TIMING_HISTORY_MS,
  CI_TIMING_MAX_ATTEMPTS,
  CI_TIMING_MAX_GRAPH_READS,
  CI_TIMING_MAX_SKIPPED_ATTEMPTS,
  ciTimingAttempt,
  type CiTimingAttempt,
  type CiTimingHistory,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import {
  isPrVerification,
  pipelineWorkflows,
  readPipelineDetails,
  requiredWorkflows,
  summarizePipeline,
  type PipelineClient,
  type PipelineSummary,
  type SourceFailure,
} from "./pipelines.ts";

const PAGE_SIZE = 50;
const PR_LIMIT = 60;
const OTHER_LIMIT = CI_TIMING_MAX_ATTEMPTS - PR_LIMIT;
const PR_EVENTS: readonly string[] = ["pull_request", "pull_request_metadata"];
const OTHER_EVENTS: readonly string[] = [
  "push",
  "tag",
  "release",
  "deployment",
  "cron",
  "manual",
];
const BATCHES = [
  { status: "success", group: "pr", limit: 12 },
  { status: "success", group: "other", limit: 8 },
  { status: "failure", group: "pr", limit: 4 },
] as const;

type Batch = (typeof BATCHES)[number];
type TimingIdentity = NonNullable<CiTimingHistory["skippedAttempts"]>[number];
type FinishedPipeline = PipelineSummary & { finishedAt: string };

function identity(pipeline: number, attempt: number): string {
  return `${String(pipeline)}:${String(attempt)}`;
}

function newestFirst(left: TimingIdentity, right: TimingIdentity): number {
  return (
    right.finishedAt.localeCompare(left.finishedAt) ||
    right.pipeline - left.pipeline ||
    right.attempt - left.attempt
  );
}

function pipelineIdentity(row: FinishedPipeline): TimingIdentity {
  return {
    pipeline: row.number,
    attempt: row.attempt,
    finishedAt: row.finishedAt,
  };
}

function partitionHistory(attempts: Iterable<CiTimingAttempt>) {
  const sorted = [...attempts].sort(newestFirst);
  return {
    pr: sorted
      .filter((entry) => PR_EVENTS.includes(entry.event))
      .slice(0, PR_LIMIT),
    other: sorted
      .filter((entry) => !PR_EVENTS.includes(entry.event))
      .slice(0, OTHER_LIMIT),
  };
}

function needsGraphRetry(attempt: CiTimingAttempt): boolean {
  return (
    attempt.graphReadFailures !== undefined &&
    attempt.graphReadFailures < CI_TIMING_MAX_GRAPH_READS
  );
}

type HistoryCandidateInput = {
  client: PipelineClient;
  stored: ReadonlyMap<string, CiTimingAttempt>;
  skipped: ReadonlyMap<string, TimingIdentity>;
  cutoff: string;
  earliestRetainable: TimingIdentity | undefined;
  signal: AbortSignal;
  batch: Batch;
};

function shouldReadCandidate(
  row: FinishedPipeline,
  input: HistoryCandidateInput,
): boolean {
  const key = identity(row.number, row.attempt);
  if (input.skipped.has(key)) return false;
  const previous = input.stored.get(key);
  // A full group's retention floor keeps old rows from being re-read.
  return previous === undefined
    ? input.earliestRetainable === undefined ||
        newestFirst(input.earliestRetainable, pipelineIdentity(row)) >= 0
    : needsGraphRetry(previous);
}

function finishedCandidate(
  row: PipelineSummary,
  cutoff: string,
  group: Batch["group"],
): FinishedPipeline | null {
  if (row.finishedAt === undefined || row.finishedAt < cutoff) return null;
  return group === "other" || isPrVerification(row)
    ? { ...row, finishedAt: row.finishedAt }
    : null;
}

/** A bounded batch extends the cache on each tick, including the initial backfill. */
async function historyCandidates(
  input: HistoryCandidateInput,
): Promise<FinishedPipeline[]> {
  const { client, cutoff, signal, batch } = input;
  const candidates = new Map<string, FinishedPipeline>();
  // A page may shift as new success rows arrive. Dedup by attempt identity.
  for (let page = 1; page <= 4; page++) {
    const rows = await client.pipelines({
      page,
      perPage: PAGE_SIZE,
      status: batch.status,
      events: batch.group === "pr" ? PR_EVENTS : OTHER_EVENTS,
      after: cutoff,
      signal,
    });
    for (const row of rows) {
      const finished = finishedCandidate(row, cutoff, batch.group);
      if (finished !== null && shouldReadCandidate(finished, input)) {
        candidates.set(identity(row.number, row.attempt), finished);
      }
    }
    if (rows.length < PAGE_SIZE || candidates.size >= batch.limit) break;
  }
  return [...candidates.values()]
    .sort((left, right) =>
      newestFirst(pipelineIdentity(left), pipelineIdentity(right)),
    )
    .slice(0, batch.limit);
}

async function readTimingAttempt(
  summary: FinishedPipeline,
  options: {
    client: PipelineClient;
    signal: AbortSignal;
    onFailure: SourceFailure;
  },
) {
  const { client, signal, onFailure } = options;
  const pipeline = await client.pipeline(summary.number, signal);
  if (
    pipeline.attempt !== summary.attempt ||
    pipeline.commit !== summary.commit ||
    pipeline.status !== summary.status ||
    pipeline.finishedAt !== summary.finishedAt
  ) {
    throw new Error("Pipeline attempt changed during timing collection");
  }
  const gateSucceeded = pipeline.workflows.some(
    (workflow) =>
      workflow.name === "ci-complete" && workflow.state === "success",
  );
  const graph = gateSucceeded
    ? await requiredWorkflows(client, pipeline, {
        signal,
        historical: true,
        onFailure,
      })
    : { names: null, retry: false };
  const attempt = ciTimingAttempt({
    ...summarizePipeline(pipeline),
    requiredWorkflows: graph.names,
    workflows: pipelineWorkflows(pipeline, [], false),
  });
  return {
    identityRow: pipelineIdentity(summary),
    attempt,
    retryGraph: graph.retry,
  };
}

export async function collectCiTimingHistory(input: {
  client: PipelineClient;
  previous: CiTimingHistory | null;
  now: Date;
  signal: AbortSignal;
  onFailure: SourceFailure;
}): Promise<CiTimingHistory> {
  const { client, previous, now, signal, onFailure } = input;
  const cutoff = new Date(now.getTime() - CI_TIMING_HISTORY_MS).toISOString();
  const stored = new Map(
    (previous?.attempts ?? [])
      .filter((attempt) => attempt.finishedAt >= cutoff)
      .map((attempt) => [identity(attempt.pipeline, attempt.attempt), attempt]),
  );
  const skipped = new Map(
    (previous?.skippedAttempts ?? [])
      .filter((row) => row.finishedAt >= cutoff)
      .map((row) => [identity(row.pipeline, row.attempt), row]),
  );
  const retained = partitionHistory(stored.values());
  const batches = await Promise.all(
    BATCHES.map((batch) => {
      const cohort = retained[batch.group];
      const limit = batch.group === "pr" ? PR_LIMIT : OTHER_LIMIT;
      return historyCandidates({
        client,
        stored,
        skipped,
        cutoff,
        earliestRetainable: cohort.length === limit ? cohort.at(-1) : undefined,
        signal,
        batch,
      });
    }),
  );
  const candidates = new Map(
    batches.flat().map((row) => [identity(row.number, row.attempt), row]),
  );
  const details = await readPipelineDetails(
    [...candidates.values()],
    (row) => readTimingAttempt(row, { client, signal, onFailure }),
    onFailure,
    signal,
  );

  for (const { identityRow, attempt, retryGraph } of details.runs) {
    const key = identity(identityRow.pipeline, identityRow.attempt);
    if (attempt === null) {
      skipped.set(key, identityRow);
      continue;
    }
    const prior = stored.get(key);
    stored.set(
      key,
      retryGraph
        ? { ...attempt, graphReadFailures: (prior?.graphReadFailures ?? 0) + 1 }
        : attempt,
    );
  }
  const groups = partitionHistory(stored.values());
  return {
    sampledAt: now.toISOString(),
    attempts: [...groups.pr, ...groups.other].sort(newestFirst),
    skippedAttempts: [...skipped.values()]
      .sort(newestFirst)
      .slice(0, CI_TIMING_MAX_SKIPPED_ATTEMPTS),
  };
}
