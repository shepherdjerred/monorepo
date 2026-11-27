import {
  CI_TIMING_HISTORY_MS,
  CI_TIMING_MAX_ATTEMPTS,
  ciTimingAttempt,
  type CiTimingAttempt,
  type CiTimingHistory,
} from "@shepherdjerred/ops-model/ci-dashboard.ts";
import {
  pipelineWorkflows,
  readPipelineDetails,
  requiredWorkflows,
  summarizePipeline,
  type PipelineClient,
  type PipelineSummary,
  type SourceFailure,
} from "./pipelines.ts";

const DETAIL_LIMIT = 24;
const PAGE_SIZE = 50;

function identity(pipeline: number, attempt: number): string {
  return `${String(pipeline)}:${String(attempt)}`;
}

/** A bounded batch extends the cache on each tick, including the initial backfill. */
async function historyCandidates(input: {
  client: PipelineClient;
  stored: ReadonlyMap<string, CiTimingAttempt>;
  cutoff: string;
  signal: AbortSignal;
  status: "success" | "failure";
  limit: number;
}): Promise<PipelineSummary[]> {
  const { client, stored, cutoff, signal, status, limit } = input;
  const candidates = new Map<string, PipelineSummary>();
  // A page may shift as new success rows arrive. Dedup by attempt identity.
  for (let page = 1; page <= 4; page++) {
    const rows = await client.pipelines({
      page,
      perPage: PAGE_SIZE,
      status,
      after: cutoff,
      signal,
    });
    for (const row of rows) {
      if (row.finishedAt === undefined || row.finishedAt < cutoff) continue;
      // A failed PR pipeline can still have a successful completion gate
      // when the failed workflow was advisory. Other failed events have
      // no usable gate result.
      if (status === "failure" && !row.ref.startsWith("refs/pull/")) continue;
      const key = identity(row.number, row.attempt);
      if (!stored.has(key)) candidates.set(key, row);
    }
    if (rows.length < PAGE_SIZE || candidates.size >= limit) break;
  }
  return [...candidates.values()]
    .sort(
      (left, right) =>
        (right.finishedAt ?? "").localeCompare(left.finishedAt ?? "") ||
        right.number - left.number,
    )
    .slice(0, limit);
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
  const completed = await historyCandidates({
    client,
    stored,
    cutoff,
    signal,
    status: "success",
    limit: DETAIL_LIMIT,
  });
  const advisory = await historyCandidates({
    client,
    stored,
    cutoff,
    signal,
    status: "failure",
    limit: 4,
  });
  const candidates = [...advisory, ...completed].slice(0, DETAIL_LIMIT);
  const details = await readPipelineDetails(
    candidates,
    async (summary) => {
      const detail = await client.pipeline(summary.number, signal);
      if (
        detail.attempt !== summary.attempt ||
        detail.commit !== summary.commit ||
        detail.status !== summary.status
      ) {
        throw new Error("Pipeline attempt changed during timing collection");
      }
      return {
        ...summarizePipeline(detail),
        requiredWorkflows: await requiredWorkflows(client, detail, {
          signal,
          onFailure,
          historical: true,
        }),
        workflows: pipelineWorkflows(detail, [], false),
      };
    },
    onFailure,
    signal,
  );

  for (const detail of details.runs) {
    const attempt = ciTimingAttempt(detail);
    if (attempt !== null && attempt.finishedAt >= cutoff) {
      stored.set(identity(attempt.pipeline, attempt.attempt), attempt);
    }
  }
  return {
    sampledAt: now.toISOString(),
    attempts: [...stored.values()]
      .sort(
        (left, right) =>
          right.finishedAt.localeCompare(left.finishedAt) ||
          right.pipeline - left.pipeline ||
          right.attempt - left.attempt,
      )
      .slice(0, CI_TIMING_MAX_ATTEMPTS),
  };
}
