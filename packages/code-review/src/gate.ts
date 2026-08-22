/**
 * The pure gate decision. Given the resolved review state for the head commit,
 * the PR's review threads, and the active provider, decide whether the gate
 * should pass, keep waiting, or fail. All I/O (fetching check-runs, reviews,
 * reactions, threads) lives in `./github.ts`; this stays pure and
 * fixture-testable — the same philosophy as the original wait-for-greptile
 * `evaluateGate`.
 */

import { isProviderAuthor } from "./identity.ts";
import { severityLabel } from "./severity.ts";
import type {
  GateDecision,
  PullRequestAuthor,
  ReviewProvider,
  ReviewState,
  ReviewThread,
} from "./types.ts";

/** Return a skip only when the provider explicitly cannot review bot PRs. */
export function reviewGateSkipReasonForAuthor(input: {
  author: PullRequestAuthor;
  provider: ReviewProvider;
}): "bot-author" | null {
  if (input.provider.botAuthoredPullRequestPolicy === "review") {
    return null;
  }

  return input.author.type === "Bot" ? "bot-author" : null;
}

/**
 * The severity that blocks unconditionally, whenever it was raised.
 *
 * Measured over PRs #2259–#2308: findings at this severity are ~50% production
 * bugs under blind grading, against 0% one tier down. That gap is what makes it
 * the right place to draw an unconditional line.
 */
export const ALWAYS_BLOCKING_PRIORITY = 1;

/**
 * When a finding below {@link ALWAYS_BLOCKING_PRIORITY} still has to be fixed.
 *
 * The loop this exists to end did not converge: over 33 PRs it ran 260
 * finding-bearing rounds, and 93% of the findings raised from round 8 onward
 * flagged a line that did not exist when the pull request was first reviewed —
 * the review was mostly reviewing its own churn. Blocking on every severity
 * forever is what fed that; blocking on the top severity alone throws away a
 * whole tier of real findings (36/36 of the sampled ones were genuine defects).
 *
 * So a lower-severity finding blocks in exactly the two cases where fixing it
 * is close to free:
 *
 * - **`first-review`** — the initial review of the diff as authored. This is the
 *   one full quality pass over code the author actually wrote, and it costs no
 *   extra round because the gate is failing on that review regardless.
 * - **`accompanied-by-blocking`** — the same review also raised an
 *   always-blocking finding, so another round is already being paid for. Bundling
 *   is measurably close to free: across 227 consecutive reviewed heads,
 *   ρ(fix size, findings in the next round) = 0.23, and a 20× larger fix drew
 *   only ~46% more findings.
 *
 * Anything else is advisory: still posted, still readable, no longer a gate.
 */
export type LowSeverityPolicy = "always" | "first-review-or-accompanied";

/** How the gate decides what blocks, independent of any single thread. */
export type BlockingPolicy = {
  /** Severities at or above this always block. */
  alwaysBlockingPriority: number;
  /**
   * The least severe priority the gate will ever block on. Findings less severe
   * than this never block, whenever they were raised.
   */
  maxBlockingPriority: number;
  /** When priorities between the two thresholds block. */
  lowSeverity: LowSeverityPolicy;
};

/**
 * Whether a finding below the always-blocking severity still has to be fixed.
 *
 * A finding that cannot be attributed to a review blocks. Attribution comes from
 * an addressable thread copy, so a null means the parser did not recognise where
 * this finding came from — and treating the least-understood findings as
 * advisory is precisely the wrong direction to fail in.
 */
function lowSeverityBlocks(
  thread: ReviewThread,
  policy: LowSeverityPolicy,
): boolean {
  if (policy === "always") return true;
  if (thread.raisedInReview === null) return true;
  return (
    thread.raisedInReview.ordinal === 1 ||
    thread.raisedInReview.hadBlockingSeverity
  );
}

/**
 * A thread blocks the gate iff it is authored by the active provider, still
 * applies to the latest revision (not resolved, not outdated), carries a
 * severity within the blocking range, and — below the always-blocking
 * severity — satisfies {@link LowSeverityPolicy}. Threads with no severity
 * badge never block.
 */
export function isBlocking(
  thread: ReviewThread,
  provider: ReviewProvider,
  policy: BlockingPolicy,
): boolean {
  if (!isProviderAuthor(provider, thread.authorLogin)) return false;
  if (thread.isResolved || thread.isOutdated) return false;
  if (thread.priority === null) return false;
  if (thread.priority > policy.maxBlockingPriority) return false;
  if (thread.priority <= policy.alwaysBlockingPriority) return true;
  return lowSeverityBlocks(thread, policy.lowSeverity);
}

/**
 * The policy a caller gets when it only knows a severity threshold.
 *
 * `REVIEW_MAX_BLOCKING_PRIORITY` stays meaningful — setting it to the
 * always-blocking severity or lower disables the low-severity rules entirely by
 * making the range empty, which is the documented escape hatch if the policy
 * needs to be neutralised from the pipeline without a revert.
 */
export function blockingPolicyForThreshold(
  maxBlockingPriority: number,
  lowSeverity: LowSeverityPolicy = "first-review-or-accompanied",
): BlockingPolicy {
  return {
    alwaysBlockingPriority: ALWAYS_BLOCKING_PRIORITY,
    maxBlockingPriority,
    lowSeverity,
  };
}

/**
 * One blocking thread as a reader needs it: what the finding is, then where.
 *
 * The title matters most and is why this is not just a location. Findings
 * parsed from a provider's issue comment carry one (threads opened on a diff
 * do not), so without it a failing gate lists file paths and the operator has
 * to open GitHub to learn what any of them are actually complaining about.
 */
function describeThread(thread: ReviewThread): string {
  const location =
    thread.path === null
      ? "(general comment)"
      : thread.line === null
        ? thread.path
        : `${thread.path}:${String(thread.line)}`;
  const title = thread.title === null ? "" : `${thread.title} — `;
  const url = thread.url === null ? "" : ` — ${thread.url}`;
  return `${title}${location}${url}`;
}

/**
 * How many findings the provider's first review raised, or `null` when no
 * finding could be attributed to a first review.
 *
 * Used for a non-blocking warning, not a decision: of the PRs whose first review
 * returned four or more findings, none converged within three rounds (median 15,
 * worst 38), while PRs at zero or one finding took a median of one round. That
 * makes the first review's count the earliest available signal that a pull
 * request wants splitting rather than iterating.
 */
export function firstReviewFindingCount(
  threads: readonly ReviewThread[],
  provider: ReviewProvider,
): number | null {
  const attributed = threads.filter(
    (thread) =>
      isProviderAuthor(provider, thread.authorLogin) &&
      thread.raisedInReview?.ordinal === 1,
  );
  return attributed.length === 0 ? null : attributed.length;
}

export function evaluateGate(input: {
  head: string;
  provider: ReviewProvider;
  reviewState: ReviewState;
  threads: readonly ReviewThread[];
  policy: BlockingPolicy;
  /** Provider skip reason (e.g. "no-reviewable-files"), or null. */
  skipReason?: string | null;
}): GateDecision {
  const { head, provider, reviewState, threads, policy } = input;
  const skipReason = input.skipReason ?? null;
  const name = provider.displayName;

  if (reviewState === "reviewing") {
    return {
      state: "waiting",
      message: `Waiting for ${name} to finish reviewing ${head}.`,
    };
  }

  if (reviewState === "errored") {
    return {
      state: "failed",
      message:
        `${name}'s review of ${head} did not complete successfully. ` +
        `Re-trigger ${name}, then re-run this step.`,
    };
  }

  const blocking = threads.filter((thread) =>
    isBlocking(thread, provider, policy),
  );

  if (blocking.length === 0) {
    const prefix =
      skipReason === null
        ? `${name} reviewed ${head}`
        : `${name} skipped review for ${head} (${skipReason})`;
    return {
      state: "passed",
      message:
        `${prefix}; no unresolved ${name} comments at ` +
        `${severityLabel(policy.maxBlockingPriority)} or more severe remain.`,
    };
  }

  const list = blocking
    .map(
      (thread) =>
        `  - ${severityLabel(thread.priority)} ${describeThread(thread)}`,
    )
    .join("\n");
  // Naming the ride-along explicitly matters: a reader who knows that these
  // lower-severity findings are only blocking because a more severe one shares
  // their review also knows that fixing them costs no additional round.
  const accompanied =
    policy.lowSeverity === "first-review-or-accompanied" &&
    blocking.some(
      (thread) =>
        thread.priority !== null &&
        thread.priority > policy.alwaysBlockingPriority &&
        thread.raisedInReview?.hadBlockingSeverity === true &&
        thread.raisedInReview.ordinal !== 1,
    )
      ? `\nLower-severity findings above share a review with a ` +
        `${severityLabel(policy.alwaysBlockingPriority)} finding, so they are ` +
        `included in the round you are already paying for.`
      : "";
  return {
    state: "failed",
    message:
      `${String(blocking.length)} unresolved ${name} comment(s) on ${head}:\n${list}${accompanied}\n` +
      `Resolve each thread (or push a fix and let ${name} re-review), then re-run this step.`,
  };
}
