/**
 * Observing one provider for one poll tick: bot-author skip check, completion
 * state, review threads, and the review request the loop may owe this head.
 *
 * Split out of `wait-for-review.ts`, which sits at the repo's max-lines cap.
 * The loop keeps control flow (pass-fast, waiting, deadline) and one snapshot
 * per provider; everything one provider needs from GitHub in a tick lives
 * here, so adding a provider never touches the loop's shape.
 */

import {
  type BlockingPolicy,
  evaluateGate,
  type GateDecision,
  type PullRequestAuthor,
  type ReviewProvider,
  type ReviewThread,
  reviewGateSkipReasonForAuthor,
} from "@shepherdjerred/code-review";
import {
  fetchPullRequestAuthor,
  fetchReviewThreads,
  resolveReviewState,
  type ReviewStateResult,
} from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import {
  ensureReviewRequested,
  requestGraceSecondsForProvider,
} from "./review-gate-policy.ts";

/** What one tick learned about one provider. */
export type ProviderObservation = {
  provider: ReviewProvider;
  /** Bot-author skip: no snapshot exists, so the gate ignores this provider. */
  skipped: boolean;
  /** The bot-author skip reason, for the skip log. */
  skipReason: string | null;
  /** Null when skipped; the resolved completion otherwise. */
  state: ReviewStateResult | null;
  threads: readonly ReviewThread[];
  /** Latest PR head seen while fetching threads, for the mismatch warning. */
  headRefOid: string | null;
  /** Head push time, fetched on first need and passed back for reuse. */
  headPushedAt: string | null;
  /** The next request attempt number for this provider and head. */
  nextAttempt: number;
  /** This provider's own gate decision, for its per-provider signal event. */
  decision: GateDecision | null;
};

/**
 * Observe `provider` once: resolve completion FIRST, then fetch threads AFTER
 * — never concurrently. A concurrent thread query can land just before the
 * provider submits its review while the state query lands just after, yielding
 * `reviewed` with the new findings missing, which would let the gate pass
 * with unresolved threads.
 */
export async function observeProviderOnce(input: {
  repo: string;
  number: number;
  head: string;
  token: string;
  provider: ReviewProvider;
  pullRequestAuthor: PullRequestAuthor;
  headPushedAt: string | null;
  policy: BlockingPolicy;
  configuredGraceSeconds: number;
  retryAfterSeconds: number;
  startedAt: number;
  attempt: number;
}): Promise<ProviderObservation> {
  const {
    repo,
    number,
    head,
    token,
    provider,
    pullRequestAuthor,
    policy,
    configuredGraceSeconds,
    retryAfterSeconds,
    startedAt,
    attempt,
  } = input;
  let { headPushedAt } = input;

  const authorSkipReason = reviewGateSkipReasonForAuthor({
    author: pullRequestAuthor,
    provider,
  });
  if (authorSkipReason !== null) {
    return {
      provider,
      skipped: true,
      skipReason: authorSkipReason,
      state: null,
      threads: [],
      headRefOid: null,
      headPushedAt,
      nextAttempt: attempt,
      decision: null,
    };
  }

  // Review-at-head and issue-comment providers bind completion to the exact
  // head push. A check-run provider never reads this timestamp, so the
  // Activity endpoint is not a prerequisite for a gate that can otherwise
  // pass on a valid check-run.
  if (
    provider.completion.kind === "review-at-head" ||
    provider.completion.kind === "issue-comment"
  ) {
    headPushedAt ??= await fetchHeadPushedAt({
      repo,
      sha: head,
      prNumber: number,
      token,
    });
  }
  const state = await resolveReviewState({
    provider,
    repo,
    head,
    prNumber: number,
    token,
    headPushedAt,
  });
  const threadResult = await fetchReviewThreads({
    repo,
    number,
    token,
    provider,
    // Reuse the comment resolveReviewState just fetched: both decisions
    // describe the identical snapshot without paginating twice per poll.
    issueComment: state.issueComment,
  });

  // Ask for the review this loop is waiting on, once the provider has not
  // already reviewed this head. Inside the same retry boundary as the reads:
  // a transient failure while checking or posting must not fail the gate.
  const nextAttempt = await ensureReviewRequested({
    repo,
    number,
    head,
    token,
    provider,
    attempt,
    graceSeconds: requestGraceSecondsForProvider(
      provider,
      configuredGraceSeconds,
    ),
    retryAfterSeconds,
    headPushedAt,
    startedAt,
    reviewedCommit: state.reviewedCommit,
    blockedReason: state.blockedReason,
  });

  const decision = evaluateGate({
    head,
    provider,
    reviewState: state.state,
    threads: threadResult.threads,
    policy,
    skipReason: state.skipReason,
    blockedReason: state.blockedReason,
  });

  return {
    provider,
    skipped: false,
    skipReason: null,
    state,
    threads: threadResult.threads,
    headRefOid: threadResult.headRefOid,
    headPushedAt,
    nextAttempt,
    decision,
  };
}

/**
 * Mutable per-run poll state, threaded through one tick at a time. The head
 * push time binds commit-less clean-review signals to this head (not
 * telemetry-only): it is fetched inside the retry loop and cached only once a
 * real timestamp resolves. A null result is deliberately NOT cached — the
 * ref-update event can be briefly unavailable right after a push, so later
 * polls re-fetch rather than poison the whole wait. One cache is shared
 * across providers; it describes the head, not the bot.
 */
export type GatePollState = {
  headPushedAt: string | null;
  pullRequestAuthor: PullRequestAuthor | null;
  /** Per-provider next request attempt, 1-based (see observeProviderOnce). */
  attempts: Map<string, number>;
  lastObservations: Map<string, ProviderObservation>;
  warnedMismatch: boolean;
  warnedOversized: Set<string>;
};

/**
 * Observe every enabled provider once. Returns null when every provider
 * declined this PR's author — nothing will ever review it.
 */
export async function observeTick(
  config: {
    providers: readonly ReviewProvider[];
    repo: string;
    number: number;
    head: string;
    token: string;
    policy: BlockingPolicy;
    configuredGraceSeconds: number;
    retryAfterSeconds: number;
  },
  poll: GatePollState,
  startedAt: number,
): Promise<ProviderObservation[] | null> {
  const {
    providers,
    repo,
    number,
    head,
    token,
    policy,
    configuredGraceSeconds,
    retryAfterSeconds,
  } = config;
  poll.pullRequestAuthor ??= await fetchPullRequestAuthor({
    repo,
    number,
    token,
  });
  const author = poll.pullRequestAuthor;
  // Providers observe sequentially, and each observes completion before
  // threads (see observeProviderOnce) — never concurrently, or the gate
  // can pass on a thread snapshot older than the review it just saw.
  const observed: ProviderObservation[] = [];
  for (const provider of providers) {
    const observation = await observeProviderOnce({
      repo,
      number,
      head,
      token,
      provider,
      pullRequestAuthor: author,
      headPushedAt: poll.headPushedAt,
      policy,
      configuredGraceSeconds,
      retryAfterSeconds,
      startedAt,
      attempt: poll.attempts.get(provider.id) ?? 1,
    });
    poll.headPushedAt = observation.headPushedAt;
    poll.attempts.set(provider.id, observation.nextAttempt);
    if (observation.skipped) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "review-gate-skipped",
          component: "review-gate",
          reason: observation.skipReason,
          provider: provider.id,
          repo,
          pr: number,
          head_sha: head,
          author_login: author.login,
          author_type: author.type,
        }),
      );
      console.log(
        `Skipping ${provider.displayName} review gate for bot-authored PR #${String(number)} (${author.login}).`,
      );
      continue;
    }
    observed.push(observation);
    poll.lastObservations.set(provider.id, observation);
  }
  // Every enabled provider declined this PR's author: nothing will ever
  // review it, so the caller returns instead of polling to the deadline.
  if (observed.length === 0) {
    console.log(
      `Skipping review gate for bot-authored PR #${String(number)} (${author.login}): no enabled provider reviews it.`,
    );
    return null;
  }
  return observed;
}
