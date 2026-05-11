import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  IngestDismissalsActivities,
  IngestDismissalsResult,
} from "#activities/pr-review/ingest-dismissals.ts";

/**
 * Polling cadence in milliseconds (15 minutes). Balances responsiveness
 * (suppressed-comment appears on next push within a quarter hour of
 * dismissal) against GitHub rate-limit budget. Tunable via the input.
 *
 * Typed as `number` rather than `@temporalio/common`'s `Duration` because
 * `Duration = StringValue | number` resolves to `any` under some CI
 * dependency-resolution states (the `ms` package's template-literal
 * `StringValue` doesn't survive every dedupe), which trips
 * `@typescript-eslint/no-unsafe-assignment`. Sticking to milliseconds
 * keeps the type concrete in every environment.
 */
const DEFAULT_POLL_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Per-loop iteration cap before continue-as-new. Temporal advises
 * recycling long-running workflows periodically so the event-history
 * stays bounded. 96 iterations × 15 min = 24 h; one fresh start per day
 * keeps history small and replay cheap.
 */
const ITERATIONS_PER_RUN = 96;

const { prReviewIngestDismissals } =
  proxyActivities<IngestDismissalsActivities>({
    // GitHub paginate + Voyage embed for unbounded comment volume.
    // Heartbeat keeps the activity alive on slow rate-limited windows.
    startToCloseTimeout: "10 minutes",
    heartbeatTimeout: "1 minute",
    retry: { maximumAttempts: 3, initialInterval: "30 seconds" },
  });

export type PrReactionListenerInput = {
  /** GitHub `owner/repo` pairs to monitor. */
  readonly repositories: readonly {
    readonly owner: string;
    readonly repo: string;
  }[];
  /**
   * Initial `since` cursor in ISO 8601 (defaults to workflow start time
   * if absent on the very first run). On continue-as-new the workflow
   * passes its rolling max-observed-at forward.
   */
  readonly initialSince?: string;
  /**
   * Override the poll interval in milliseconds for testing / shadow mode.
   */
  readonly pollIntervalMs?: number;
};

/**
 * Long-running 15-minute poll for dismissal signals. Recycles itself via
 * `continueAsNew` after `ITERATIONS_PER_RUN` iterations so history stays
 * bounded. The cursor (`maxObservedAt` from the last ingest result) is
 * threaded forward across both iterations and continue-as-new boundaries.
 */
export async function prReactionListener(
  input: PrReactionListenerInput,
): Promise<void> {
  const startTime = workflowInfo().startTime;
  let cursor =
    input.initialSince ??
    new Date(startTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const pollIntervalMs: number =
    input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    const perRepoResults: IngestDismissalsResult[] = [];
    for (const repo of input.repositories) {
      const result = await prReviewIngestDismissals(
        { owner: repo.owner, repo: repo.repo },
        { since: cursor },
      );
      perRepoResults.push(result);
    }
    // Advance cursor to the max observed across all repos. If nothing
    // was observed, leave the cursor where it was.
    let nextCursor = cursor;
    for (const r of perRepoResults) {
      if (r.maxObservedAt > nextCursor) nextCursor = r.maxObservedAt;
    }
    cursor = nextCursor;

    await sleep(pollIntervalMs);
  }

  await continueAsNew<typeof prReactionListener>({
    repositories: input.repositories,
    initialSince: cursor,
    ...(input.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: input.pollIntervalMs }),
  });
}
