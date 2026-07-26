import { Context } from "@temporalio/activity";
import { Octokit } from "octokit";
import * as Sentry from "@sentry/bun";
import {
  isBlocking,
  isProviderAuthor,
  REVIEW_SIGNAL_SCHEMA,
  resolveProvider,
  tallyFindings,
  type ReviewProvider,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";
import {
  fetchHeadPushedAt,
  fetchReviewThreads,
  resolveReviewState,
} from "@shepherdjerred/code-review/github";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { requiredRunId } from "#activities/temporal-context.ts";
import { putS3Object } from "#shared/s3.ts";
import {
  summarizeReviewSignals,
  type ReviewSignalSummary,
} from "#shared/review-signals.ts";
import {
  reviewCompletionLatencySeconds,
  reviewCompletionSignalTotal,
  reviewFindingsPerPr,
  reviewFindingsTotal,
  reviewReviewedHeadTotal,
  reviewStaleReactionTotal,
} from "#observability/metrics.ts";

/**
 * Durable review-signal collector: scans recent PRs, computes each PR's
 * code-review signal via `@shepherdjerred/code-review` (the same
 * provider-neutral model the CI gate — `scripts/wait-for-review.ts` — uses),
 * records Prometheus metrics, and appends the signals as NDJSON to S3. A
 * longitudinal dataset of "what the review bot (Codex by default) did and
 * when", independent of the ephemeral gate logs.
 */

const COMPONENT = "review-signal-collector";
const DEFAULT_REPO = "shepherdjerred/monorepo";
const DEFAULT_PR_LIMIT = 30;
const CONCURRENCY_LIMIT = 5;
const HEARTBEAT_INTERVAL_MS = 10_000;
// Matches the CI gate's default (REVIEW_MAX_BLOCKING_PRIORITY unset ⇒ P3);
// the collector is a fixed observer, not configurable per-run.
const MAX_BLOCKING_PRIORITY = 3;

export type ObserveReviewSignalsInput = {
  /** `owner/repo`, defaults to the monorepo itself. */
  repo?: string;
  /** Max PRs to scan per run (most-recently-updated first). */
  limit?: number;
};

export type ObserveReviewSignalsResult = {
  provider: string;
  repo: string;
  prsScanned: number;
  eventsRecorded: number;
  errored: number;
  s3Bucket: string;
  s3Key: string;
  durationSeconds: number;
  summary: ReviewSignalSummary;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

type ReviewSignalArchiveConfig = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
};

/** Existing shared archive bucket; the collector writes under a `review-signals/` key prefix. */
const DEFAULT_ARCHIVE_BUCKET = "llm-archive";

/**
 * Reuses the shared S3/SeaweedFS credential envs (`AWS_ACCESS_KEY_ID`,
 * `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`
 * — documented in this package's CLAUDE.md). The bucket defaults to the
 * existing `llm-archive` archive bucket (namespaced by the `review-signals/`
 * key prefix) so the collector needs no new bucket/env to start; override with
 * `REVIEW_SIGNAL_ARCHIVE_BUCKET` to write elsewhere.
 */
function loadReviewSignalArchiveConfig(): ReviewSignalArchiveConfig {
  return {
    bucket: Bun.env["REVIEW_SIGNAL_ARCHIVE_BUCKET"] ?? DEFAULT_ARCHIVE_BUCKET,
    accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
    sessionToken: Bun.env["AWS_SESSION_TOKEN"],
    endpoint: requiredEnv("S3_ENDPOINT"),
    region: Bun.env["S3_REGION"] ?? "us-east-1",
    forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
  };
}

function splitOwnerRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (owner === undefined || name === undefined || name === "") {
    throw new Error(`repo must be in "owner/name" form, got "${repo}"`);
  }
  return { owner, name };
}

/**
 * Builds one `ReviewSignalEvent` for a single PR head, mirroring
 * `scripts/probe-review-signal.ts` / `scripts/wait-for-review.ts` exactly
 * (including the latency guard and the head-bound `reviewed_at_head` flag).
 */
async function buildSignalEvent(input: {
  provider: ReviewProvider;
  repo: string;
  prNumber: number;
  head: string;
  token: string;
}): Promise<ReviewSignalEvent> {
  const { provider, repo, prNumber, head, token } = input;

  // Head push time first — `resolveReviewState` needs it to bind a 👍 reaction
  // to the current head. Then resolve completion state, and fetch threads
  // strictly AFTER (never concurrently): a concurrent thread query can capture
  // the pre-review snapshot while the state query observes the completed review,
  // archiving a "reviewed" event that undercounts the newly-created findings and
  // unresolved threads. Sequential ordering keeps the archived observation
  // internally consistent (same fix as the CI gate).
  const headPushedAt = await fetchHeadPushedAt({ repo, sha: head, token });
  const state = await resolveReviewState({
    provider,
    repo,
    head,
    prNumber,
    token,
    headPushedAt,
  });
  const threadResult = await fetchReviewThreads({
    repo,
    number: prNumber,
    token,
    provider,
  });

  const providerThreads = threadResult.threads.filter(
    (thread) =>
      isProviderAuthor(provider, thread.authorLogin) && !thread.isOutdated,
  );
  const blocking = threadResult.threads.filter((thread) =>
    isBlocking(thread, provider, MAX_BLOCKING_PRIORITY),
  );

  // Latency only when the reviewed commit IS the head (else a stale review of
  // an older commit gives a bogus/negative latency); see probe-review-signal.ts.
  const atHead = state.reviewedCommit === head;
  const reviewedAt = atHead ? state.reviewedAt : null;
  const latencyS =
    reviewedAt !== null && headPushedAt !== null
      ? Math.round((Date.parse(reviewedAt) - Date.parse(headPushedAt)) / 1000)
      : null;

  return {
    schema: REVIEW_SIGNAL_SCHEMA,
    ts: new Date().toISOString(),
    provider: provider.id,
    pr: prNumber,
    head_sha: head,
    head_pushed_at: headPushedAt,
    review_state:
      state.completionSignal === "thumbsup-reaction"
        ? "reviewed-clean-reaction"
        : state.state,
    completion_signal: state.completionSignal,
    reviewed_at_head: atHead,
    latency_s: latencyS,
    findings: tallyFindings(providerThreads.map((thread) => thread.priority)),
    blocking_count: blocking.length,
    unresolved_count: providerThreads.filter((thread) => !thread.isResolved)
      .length,
    gate_wait_s: null,
    timed_out: false,
    stale_reaction: state.staleReaction,
    decision: null,
  };
}

function recordEventMetrics(
  providerId: string,
  event: ReviewSignalEvent,
): void {
  if (event.latency_s !== null) {
    reviewCompletionLatencySeconds.observe(
      { provider: providerId },
      event.latency_s,
    );
  }

  reviewFindingsTotal.inc(
    { provider: providerId, severity: "p0" },
    event.findings.p0,
  );
  reviewFindingsTotal.inc(
    { provider: providerId, severity: "p1" },
    event.findings.p1,
  );
  reviewFindingsTotal.inc(
    { provider: providerId, severity: "p2" },
    event.findings.p2,
  );
  reviewFindingsTotal.inc(
    { provider: providerId, severity: "p3" },
    event.findings.p3,
  );
  reviewFindingsTotal.inc(
    { provider: providerId, severity: "unknown" },
    event.findings.unknown,
  );

  const totalFindings =
    event.findings.p0 +
    event.findings.p1 +
    event.findings.p2 +
    event.findings.p3 +
    event.findings.unknown;
  reviewFindingsPerPr.observe({ provider: providerId }, totalFindings);

  reviewCompletionSignalTotal.inc({
    provider: providerId,
    signal: event.completion_signal,
  });

  if (event.stale_reaction) {
    reviewStaleReactionTotal.inc({ provider: providerId });
  }

  reviewReviewedHeadTotal.inc({
    provider: providerId,
    at_head: event.reviewed_at_head ? "true" : "false",
  });
}

type PrHead = { number: number; headSha: string };

async function listRecentPrs(
  octokit: Octokit,
  repo: string,
  limit: number,
): Promise<PrHead[]> {
  const { owner, name } = splitOwnerRepo(repo);
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo: name,
    state: "all",
    sort: "updated",
    direction: "desc",
    per_page: limit,
  });
  return data.map((pr) => ({ number: pr.number, headSha: pr.head.sha }));
}

/**
 * Observes one PR's review signal. Failures here are per-PR telemetry
 * failures (a flaky GraphQL call, a deleted PR, etc.) — the caller logs +
 * continues rather than aborting the whole run. Metrics are deliberately NOT
 * recorded here: they are recorded once, after the S3 archive upload succeeds
 * (see `runObserveReviewSignalsImpl`), so an activity retry after a failed
 * upload cannot double-count the same observations.
 */
async function observeOnePr(input: {
  provider: ReviewProvider;
  repo: string;
  pr: PrHead;
  token: string;
}): Promise<ReviewSignalEvent | null> {
  const { provider, repo, pr, token } = input;
  try {
    return await buildSignalEvent({
      provider,
      repo,
      prNumber: pr.number,
      head: pr.headSha,
      token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.withScope((scope) => {
      scope.setTag("component", COMPONENT);
      scope.setContext("pr", {
        prNumber: pr.number,
        headSha: pr.headSha,
        repo,
      });
      Sentry.captureException(error);
    });
    jsonLog("warning", "review-signal observation failed for PR; continuing", {
      prNumber: pr.number,
      headSha: pr.headSha,
      error: message,
    });
    return null;
  }
}

async function observeAllPrs(input: {
  provider: ReviewProvider;
  repo: string;
  prs: PrHead[];
  token: string;
}): Promise<{ events: ReviewSignalEvent[]; errored: number }> {
  const { provider, repo, prs, token } = input;
  const events: ReviewSignalEvent[] = [];
  let errored = 0;

  for (let i = 0; i < prs.length; i += CONCURRENCY_LIMIT) {
    const batch = prs.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.all(
      batch.map((pr) => observeOnePr({ provider, repo, pr, token })),
    );
    for (const event of results) {
      if (event === null) {
        errored += 1;
      } else {
        events.push(event);
      }
    }
  }

  return { events, errored };
}

/**
 * Archive key for a collection run. The filename is a STABLE per-run id (the
 * Temporal workflow run id) rather than a wall-clock timestamp, so if Temporal
 * re-runs the activity (a lost completion ack, a retry) the archive overwrites
 * the same object instead of writing a second, duplicate NDJSON file.
 */
function buildArchiveKey(now: Date, runId: string): string {
  const dateStr = now.toISOString().slice(0, 10);
  return `review-signals/${dateStr}/${runId}.ndjson`;
}

async function runObserveReviewSignalsImpl(
  input: ObserveReviewSignalsInput,
  runId: string,
): Promise<ObserveReviewSignalsResult> {
  const start = Date.now();
  const repo = input.repo ?? DEFAULT_REPO;
  const limit = input.limit ?? DEFAULT_PR_LIMIT;
  const provider = resolveProvider(Bun.env["REVIEW_PROVIDER"]);

  // Total failures here (bad app credentials, GitHub outage) must propagate —
  // this is a boundary/telemetry job, but a run that can't even authenticate
  // or list PRs has nothing to observe.
  const tokenResult = await createGitHubAppInstallationToken();
  const octokit = new Octokit({ auth: tokenResult.token });
  const prs = await listRecentPrs(octokit, repo, limit);

  const { events, errored } = await observeAllPrs({
    provider,
    repo,
    prs,
    token: tokenResult.token,
  });

  // Isolated per-PR errors are tolerated (partial success), but if EVERY PR in
  // a non-empty batch failed, the cause is systematic (GraphQL permissions
  // changed, the review-thread endpoint is down, …) — throw so Temporal applies
  // its retries instead of archiving an empty run and recording a green
  // scheduled execution that collected nothing.
  if (prs.length > 0 && events.length === 0) {
    throw new Error(
      `review-signal collection produced 0 events across ${String(prs.length)} PR(s) ` +
        `(${String(errored)} errored); treating as a systematic failure so Temporal retries.`,
    );
  }

  const ndjson = events.map((event) => JSON.stringify(event)).join("\n");
  const now = new Date();
  const key = buildArchiveKey(now, runId);
  const s3Config = loadReviewSignalArchiveConfig();
  await putS3Object(
    {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
      sessionToken: s3Config.sessionToken,
      endpoint: s3Config.endpoint,
      bucket: s3Config.bucket,
      key,
      region: s3Config.region,
      forcePathStyle: s3Config.forcePathStyle,
      contentType: "application/x-ndjson",
    },
    ndjson.length > 0 ? `${ndjson}\n` : "",
  );

  // Record metrics ONLY after the archive upload succeeds, as the final side
  // effect of the run. Any failure that triggers an activity retry (token mint,
  // PR listing, the S3 upload above) happens before this point, so a retried
  // run cannot re-increment counters/histograms for observations it already
  // recorded on a prior attempt. NOTE: this does NOT cover Temporal's
  // at-least-once completion window (upload + metrics succeed, the completion
  // ack is lost, the activity re-runs) — a Prometheus counter increment is not
  // idempotent. Fully deduping metric side effects across retries AND across the
  // 6-hourly scheduled scans needs a persistent seen-set keyed by
  // (provider, PR, head); tracked in
  // packages/docs/todos/review-signal-cross-run-metric-dedup.md.
  for (const event of events) {
    recordEventMetrics(provider.id, event);
  }

  const summary = summarizeReviewSignals(events);
  const durationSeconds = (Date.now() - start) / 1000;

  const result: ObserveReviewSignalsResult = {
    provider: provider.id,
    repo,
    prsScanned: prs.length,
    eventsRecorded: events.length,
    errored,
    s3Bucket: s3Config.bucket,
    s3Key: key,
    durationSeconds,
    summary,
  };

  jsonLog("info", "runObserveReviewSignals complete", { ...result });

  return result;
}

export type ObserveReviewSignalsActivities =
  typeof observeReviewSignalsActivities;

export const observeReviewSignalsActivities = {
  async runObserveReviewSignals(
    input: ObserveReviewSignalsInput = {},
  ): Promise<ObserveReviewSignalsResult> {
    const start = Date.now();
    const heartbeat = setInterval(() => {
      Context.current().heartbeat({
        phase: "runObserveReviewSignals",
        elapsedMs: Date.now() - start,
      });
    }, HEARTBEAT_INTERVAL_MS);
    try {
      // The workflow run id is stable across activity retries within this
      // scheduled run, so it keys the archive object idempotently.
      const runId = requiredRunId(Context.current().info);
      return await runObserveReviewSignalsImpl(input, runId);
    } finally {
      clearInterval(heartbeat);
    }
  },
};
