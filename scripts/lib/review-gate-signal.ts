/**
 * Building the shared `review-signal` observability event from what the gate
 * observed. Pure: the caller does the I/O and the logging.
 *
 * Split out of `wait-for-review.ts`, which sits at the repo's max-lines cap.
 */

import {
  isBlocking,
  isProviderAuthor,
  REVIEW_SIGNAL_SCHEMA,
  tallyFindings,
  type BlockingPolicy,
  type GateDecision,
  type ReviewProvider,
  type ReviewSignalEvent,
  type ReviewThread,
} from "@shepherdjerred/code-review";
import type { ReviewStateResult } from "@shepherdjerred/code-review/github";

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

/**
 * The commit of the `code-review` source that produced this observation.
 *
 * `review-gate.sh` runs the gate from a worktree of `main` and passes the
 * commit it checked out. Recording it makes the log say which parser produced
 * a count — the one thing that would have made an inflated `blocking_count`
 * obvious at a glance rather than after a long hunt.
 */
function parserCommit(): string | null {
  const commit = Bun.env["REVIEW_GATE_PARSER_COMMIT"];
  return commit === undefined || commit.trim() === "" ? null : commit.trim();
}

export function buildSignalEvent(input: {
  provider: ReviewProvider;
  pr: number;
  head: string;
  headPushedAt: string | null;
  state: ReviewStateResult;
  threads: readonly ReviewThread[];
  policy: BlockingPolicy;
  gateWaitSeconds: number;
  timedOut: boolean;
  decision: GateDecision | null;
  requestAttempts: number;
}): ReviewSignalEvent {
  const providerThreads = input.threads.filter(
    (thread) =>
      isProviderAuthor(input.provider, thread.authorLogin) &&
      !thread.isOutdated,
  );
  const blocking = input.threads.filter((thread) =>
    isBlocking(thread, input.provider, input.policy),
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
    reviewed_at_head: input.state.reviewedCommit === input.head,
    // Latency is only meaningful when the reviewed commit IS the head; a stale
    // review of an older commit must not produce a (possibly negative) latency.
    latency_s:
      input.state.reviewedCommit === input.head
        ? latencySeconds(input.state.reviewedAt, input.headPushedAt)
        : null,
    findings: tallyFindings(providerThreads.map((thread) => thread.priority)),
    blocking_count: blocking.length,
    unresolved_count: providerThreads.filter((thread) => !thread.isResolved)
      .length,
    gate_wait_s: input.gateWaitSeconds,
    timed_out: input.timedOut,
    stale_reaction: input.state.staleReaction,
    decision: input.decision === null ? null : input.decision.state,
    request_attempts: input.requestAttempts,
    parser_commit: parserCommit(),
  };
}
