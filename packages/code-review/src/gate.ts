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
  if (input.author.type !== "Bot") return null;
  return input.provider.botAuthoredPullRequestPolicy === "review" &&
    (input.provider.botAuthorAllowlist === undefined ||
      input.provider.botAuthorAllowlist.some(
        (login) => login.toLowerCase() === input.author.login.toLowerCase(),
      ))
    ? null
    : "bot-author";
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
  return (
    policy === "always" ||
    thread.raisedInReview === null ||
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
  return (
    isProviderAuthor(provider, thread.authorLogin) &&
    !thread.isResolved &&
    !thread.isOutdated &&
    thread.priority !== null &&
    thread.priority <= policy.maxBlockingPriority &&
    (thread.priority <= policy.alwaysBlockingPriority ||
      lowSeverityBlocks(thread, policy.lowSeverity))
  );
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
  /** Provider-side block slug (e.g. "usage-limited"), or null. */
  blockedReason?: string | null;
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
    const blocked = input.blockedReason ?? null;
    const strategy = provider.detectBlocked;
    // A recognised block names the operator's real next action (adding
    // credits, not re-triggering a review that quota will reject again).
    if (blocked !== null && strategy !== null && blocked === strategy.reason) {
      return {
        state: "failed",
        message:
          `${name}'s review of ${head} is blocked (${blocked}): ` +
          `${strategy.remediation}, then re-run this step.`,
        blockedReason: blocked,
      };
    }
    const unrecognised = blocked === null ? "" : ` (block reason: ${blocked})`;
    return {
      state: "failed",
      message:
        `${name}'s review of ${head} did not complete successfully${unrecognised}. ` +
        `Re-trigger ${name}, then re-run this step.`,
      blockedReason: null,
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
    blockedReason: null,
  };
}

/**
 * One provider's resolved snapshot for a multi-provider gate evaluation. The
 * poll loop resolves each enabled provider independently (completion first,
 * then threads — never concurrently) and evaluates the snapshots together.
 */
export type ProviderGateSnapshot = {
  provider: ReviewProvider;
  reviewState: ReviewState;
  threads: readonly ReviewThread[];
  /** Provider skip reason (e.g. "no-reviewable-files"), or null. */
  skipReason?: string | null;
  /** Provider-side block slug (e.g. "usage-limited"), or null. */
  blockedReason?: string | null;
};

/**
 * Unresolved P0 threads standing anywhere across the enabled providers.
 *
 * A P0 vetoes the whole gate even when another provider already passed: the
 * OR-gate trusts one clean review, but a top-severity finding somebody still
 * stands by is not something a second opinion overrules. Only the owning
 * provider's own unresolved, current threads count — another login quoting a
 * P0, a resolved thread, or an outdated anchor vetoes nothing. Evaluated
 * before waiting states so a standing P0 fails fast instead of burning the
 * polling budget while its author must act regardless.
 */
export function vetoThreads(
  snapshots: readonly ProviderGateSnapshot[],
): { provider: ReviewProvider; thread: ReviewThread }[] {
  return snapshots.flatMap((snapshot) =>
    snapshot.threads
      .filter(
        (thread) =>
          isProviderAuthor(snapshot.provider, thread.authorLogin) &&
          !thread.isResolved &&
          !thread.isOutdated &&
          thread.priority === 0,
      )
      .map((thread) => ({ provider: snapshot.provider, thread })),
  );
}

/**
 * Combine one evaluation pass across providers into a single gate decision.
 *
 * - Any `passed` provider passes the gate unless a P0 veto stands.
 * - A P0 veto fails fast, even while other providers are still reviewing.
 * - Otherwise any `waiting` provider keeps the gate waiting.
 * - When every provider failed, unanimous provider-side blocks stay on the
 *   soft-fail path (`blockedReason` set → exit 42); a single findings failure
 *   among them makes the gate fail hard (exit 1) with the blocked providers
 *   noted as ignored.
 */
export function evaluateMultiGate(input: {
  head: string;
  providers: readonly ProviderGateSnapshot[];
  policy: BlockingPolicy;
}): GateDecision {
  const { head, providers, policy } = input;
  if (providers.length === 0) {
    throw new Error("evaluateMultiGate needs at least one provider snapshot");
  }
  const evaluated = providers.map((snapshot) => ({
    snapshot,
    decision: evaluateGate({
      head,
      provider: snapshot.provider,
      reviewState: snapshot.reviewState,
      threads: snapshot.threads,
      policy,
      skipReason: snapshot.skipReason ?? null,
      blockedReason: snapshot.blockedReason ?? null,
    }),
  }));

  const vetoes = vetoThreads(providers);
  const passed = evaluated.filter(
    ({ decision }) => decision.state === "passed",
  );
  if (passed.length > 0 && vetoes.length === 0) {
    const names = passed
      .map(({ snapshot }) => snapshot.provider.displayName)
      .join(", ");
    return {
      state: "passed",
      message:
        `${names} reviewed ${head} with no blocking findings; ` +
        `no unresolved P0 from any provider remains.`,
    };
  }

  if (vetoes.length > 0) {
    const list = vetoes
      .map(
        ({ provider, thread }) =>
          `  - P0 ${provider.displayName} ${describeThread(thread)}`,
      )
      .join("\n");
    return {
      state: "failed",
      message:
        `${String(vetoes.length)} unresolved P0 comment(s) on ${head} veto the gate:\n${list}\n` +
        `Resolve each P0 thread, then re-run this step.`,
      blockedReason: null,
    };
  }

  const waiting = evaluated.filter(
    ({ decision }) => decision.state === "waiting",
  );
  if (waiting.length > 0) {
    const names = waiting
      .map(({ snapshot }) => snapshot.provider.displayName)
      .join(", ");
    return {
      state: "waiting",
      message: `Waiting for ${names} to finish reviewing ${head}.`,
    };
  }

  const failed = evaluated.filter(
    ({ decision }) => decision.state === "failed",
  );
  const blockedReasons = failed.map(({ decision }) =>
    decision.state === "failed" ? decision.blockedReason : null,
  );
  if (blockedReasons.every((reason) => reason !== null)) {
    const names = failed
      .map(({ snapshot }) => snapshot.provider.displayName)
      .join(", ");
    const reasons = [...new Set(blockedReasons)].join(", ");
    return {
      state: "failed",
      message:
        `No provider could review ${head}: ${names} reported ${reasons}. ` +
        `Resolve the provider blocks, then re-run this step.`,
      blockedReason: blockedReasons[0] ?? null,
    };
  }

  const details = failed
    .map(({ decision }) =>
      decision.state === "failed" ? decision.message : "",
    )
    .join("\n");
  const ignored = evaluated
    .filter(
      ({ decision }) =>
        decision.state === "failed" && decision.blockedReason !== null,
    )
    .map(({ snapshot }) => snapshot.provider.displayName)
    .join(", ");
  const ignoredNote =
    ignored === "" ? "" : ` Ignored blocked provider(s): ${ignored}.`;
  return {
    state: "failed",
    message: `${details}${ignoredNote}`,
    blockedReason: null,
  };
}

/** The gate's exit status for every failure other than a provider block. */
export const REVIEW_GATE_FAILURE_EXIT_CODE = 1;

/**
 * The gate's exit status when the provider declared it could not review at all
 * (quota exhaustion). The Buildkite step soft-fails on exactly this status, so
 * an out-of-quota provider stops failing the rest of CI, while findings,
 * unresolved threads, timeouts, and every other error still fail hard.
 * `.buildkite/pipeline.yml` and `select-pr-pipeline.ts` pin the same number.
 */
export const REVIEW_GATE_BLOCKED_EXIT_CODE = 42;

/** Map a terminal gate decision to the gate's process exit status. */
export function gateExitCode(decision: GateDecision): number {
  switch (decision.state) {
    case "passed": {
      return 0;
    }
    case "failed": {
      return decision.blockedReason === null
        ? REVIEW_GATE_FAILURE_EXIT_CODE
        : REVIEW_GATE_BLOCKED_EXIT_CODE;
    }
    case "waiting": {
      throw new Error("a waiting gate decision has no exit status");
    }
  }
}
