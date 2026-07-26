/**
 * PR-only merge gate: passes once the configured code-review provider has
 * finished reviewing the PR head commit AND every provider review comment that
 * still applies to the latest revision has been resolved.
 *
 * Provider-neutral: the active provider (Greptile, Codex, …) is chosen by
 * `REVIEW_PROVIDER` (default `codex`). All provider-specific knowledge — how
 * completion is detected (a check-run vs a review-at-head + 👍 reaction), how
 * severity badges are parsed, how a deliberate skip is signalled — lives in
 * `@shepherdjerred/code-review`. This script only drives the poll loop and
 * emits structured `review-signal` observability events.
 *
 * Why not just wait for the provider's own status check? Greptile's check goes
 * green as soon as the review *completes*, regardless of whether its comments
 * were addressed; Codex posts no check at all. So we gate on resolved review
 * threads and use the provider's completion signal only as the "reviewed this
 * head?" marker.
 */

import {
  evaluateGate,
  formatSignalEvent,
  isBlocking,
  isProviderAuthor,
  REVIEW_SIGNAL_SCHEMA,
  resolveProvider,
  tallyFindings,
  type GateDecision,
  type ReviewProvider,
  type ReviewSignalEvent,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import {
  fetchCommitCommittedAt,
  fetchReviewThreads,
  resolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";

const DEFAULT_REPO = "shepherdjerred/monorepo";
const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
const DEFAULT_INTERVAL_SECONDS = 30;

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = Bun.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

function parseMaxBlockingPriority(): number {
  const raw = Bun.env["REVIEW_MAX_BLOCKING_PRIORITY"];
  if (raw === undefined || raw.trim() === "") return 3;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error(
      `REVIEW_MAX_BLOCKING_PRIORITY must be an integer in [0,3], got ${raw}`,
    );
  }
  return parsed;
}

function repoFromEnvironment(): string {
  const explicit = Bun.env["GITHUB_REPOSITORY"];
  if (explicit !== undefined && explicit.trim() !== "") return explicit.trim();

  const buildkiteRepo = Bun.env["BUILDKITE_REPO"];
  if (buildkiteRepo === undefined || buildkiteRepo.trim() === "") {
    return DEFAULT_REPO;
  }
  const sshMatch = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u.exec(
    buildkiteRepo,
  );
  if (sshMatch?.[1] !== undefined) return sshMatch[1];
  const httpsMatch = /github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u.exec(
    buildkiteRepo,
  );
  if (httpsMatch?.[1] !== undefined) return httpsMatch[1];
  return DEFAULT_REPO;
}

function latencySeconds(
  reviewedAt: string | null,
  headPushedAt: string | null,
): number | null {
  if (reviewedAt === null || headPushedAt === null) return null;
  const reviewed = Date.parse(reviewedAt);
  const pushed = Date.parse(headPushedAt);
  if (!Number.isFinite(reviewed) || !Number.isFinite(pushed)) return null;
  return Math.round((reviewed - pushed) / 1000);
}

function buildSignalEvent(input: {
  provider: ReviewProvider;
  pr: number;
  head: string;
  headPushedAt: string | null;
  state: ReviewStateResult;
  threads: readonly ReviewThread[];
  maxBlockingPriority: number;
  gateWaitSeconds: number;
  timedOut: boolean;
  decision: GateDecision | null;
}): ReviewSignalEvent {
  const providerThreads = input.threads.filter(
    (thread) =>
      isProviderAuthor(input.provider, thread.authorLogin) &&
      !thread.isOutdated,
  );
  const blocking = input.threads.filter((thread) =>
    isBlocking(thread, input.provider, input.maxBlockingPriority),
  );
  const reviewState =
    input.state.completionSignal === "thumbsup-reaction"
      ? "reviewed-clean-reaction"
      : input.state.state;
  return {
    schema: REVIEW_SIGNAL_SCHEMA,
    ts: new Date().toISOString(),
    provider: input.provider.id,
    pr: input.pr,
    head_sha: input.head,
    head_pushed_at: input.headPushedAt,
    review_state: reviewState,
    completion_signal: input.state.completionSignal,
    latency_s: latencySeconds(input.state.reviewedAt, input.headPushedAt),
    findings: tallyFindings(providerThreads.map((thread) => thread.priority)),
    blocking_count: blocking.length,
    unresolved_count: providerThreads.filter((thread) => !thread.isResolved)
      .length,
    gate_wait_s: input.gateWaitSeconds,
    timed_out: input.timedOut,
    stale_reaction: input.state.staleReaction,
    decision: input.decision === null ? null : input.decision.state,
  };
}

async function waitForReview(): Promise<void> {
  const pullRequest = Bun.env["BUILDKITE_PULL_REQUEST"];
  if (
    pullRequest === undefined ||
    pullRequest === "" ||
    pullRequest === "false"
  ) {
    console.log("Not a Buildkite pull request build; skipping review gate.");
    return;
  }
  const number = Number.parseInt(pullRequest, 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(
      `BUILDKITE_PULL_REQUEST must be a positive integer, got ${pullRequest}`,
    );
  }

  const token = Bun.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required to query GitHub review threads");
  }

  const commit = Bun.env["BUILDKITE_COMMIT"];
  if (commit === undefined || commit.trim() === "") {
    throw new Error("BUILDKITE_COMMIT is required to identify the PR head");
  }
  const head = commit.trim();
  const repo = repoFromEnvironment();
  const provider = resolveProvider(Bun.env["REVIEW_PROVIDER"]);
  const maxBlockingPriority = parseMaxBlockingPriority();
  const timeoutSeconds = parsePositiveIntegerEnv(
    "REVIEW_WAIT_TIMEOUT_SECONDS",
    DEFAULT_TIMEOUT_SECONDS,
  );
  const intervalSeconds = parsePositiveIntegerEnv(
    "REVIEW_WAIT_INTERVAL_SECONDS",
    DEFAULT_INTERVAL_SECONDS,
  );

  // Head-commit timestamp (for review-latency in the signal events). A failure
  // here must not fail the gate — it is telemetry only.
  let headPushedAt: string | null = null;
  try {
    headPushedAt = await fetchCommitCommittedAt({ repo, sha: head, token });
  } catch (error) {
    console.warn(
      `Could not read head commit timestamp for latency: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  console.log(
    `Review gate: provider=${provider.id}, repo=${repo}, pr=#${String(number)}, head=${head}, ` +
      `timeout=${String(timeoutSeconds)}s, blockingPriority<=P${String(maxBlockingPriority)}.`,
  );

  const startedAt = Date.now();
  const deadline = startedAt + timeoutSeconds * 1000;
  let warnedMismatch = false;

  while (Date.now() <= deadline) {
    const [threadResult, stateResult] = await Promise.all([
      fetchReviewThreads({ repo, number, token, provider }),
      resolveReviewState({ provider, repo, head, prNumber: number, token }),
    ]);

    if (
      !warnedMismatch &&
      threadResult.headRefOid !== null &&
      threadResult.headRefOid !== head
    ) {
      console.warn(
        `PR #${String(number)} head is now ${threadResult.headRefOid}, but this build is for ${head}; evaluating ${head}.`,
      );
      warnedMismatch = true;
    }

    const decision = evaluateGate({
      head,
      provider,
      reviewState: stateResult.state,
      threads: threadResult.threads,
      maxBlockingPriority,
      skipReason: stateResult.skipReason,
    });

    const gateWaitSeconds = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      formatSignalEvent(
        buildSignalEvent({
          provider,
          pr: number,
          head,
          headPushedAt,
          state: stateResult,
          threads: threadResult.threads,
          maxBlockingPriority,
          gateWaitSeconds,
          timedOut: false,
          decision,
        }),
      ),
    );

    if (decision.state === "passed") {
      console.log(decision.message);
      return;
    }
    if (decision.state === "failed") {
      throw new Error(decision.message);
    }
    console.log(decision.message);
    await Bun.sleep(intervalSeconds * 1000);
  }

  throw new Error(
    `Timed out after ${String(timeoutSeconds)}s waiting for ${provider.displayName} to finish reviewing ${repo}@${head}. ` +
      `If ${provider.displayName} is enabled, confirm it authors reviews/threads as one of [${provider.authorLogins.join(", ")}] ` +
      `(override the active provider with REVIEW_PROVIDER).`,
  );
}

if (import.meta.main) {
  try {
    await waitForReview();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
