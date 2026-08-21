/**
 * Policy the CI review gate applies around its poll loop: when an unanswered
 * review request is asked again, and when a first review is large enough to
 * warn that the pull request will not converge.
 *
 * Split out of `wait-for-review.ts`, which sits at the repo's max-lines cap.
 * Both decisions are about *pacing the loop* rather than about whether the head
 * is reviewed, so they read better apart from the polling machinery anyway.
 */

import {
  findReviewRequest,
  MAX_REVIEW_REQUEST_ATTEMPTS,
  requestReviewAtHead,
} from "@shepherdjerred/code-review/request-review";
import {
  firstReviewFindingCount,
  type ReviewProvider,
  type ReviewThread,
} from "@shepherdjerred/code-review";

/**
 * How long an unanswered review request waits before it is asked again.
 *
 * Must exceed ordinary provider latency or the retry is noise: completed Qodo
 * reviews have been measured at 1637s and 1834s, so this sits above the second
 * of those. Tune from the `attempt` field on the `review-signal` events rather
 * than by guessing.
 */
export const DEFAULT_REQUEST_RETRY_SECONDS = 31 * 60;

/**
 * Whether it is time to make request `attempt` for this head.
 *
 * The first attempt is made as soon as the provider is seen not to have
 * reviewed the head. A later attempt waits for the previous one to have gone
 * unanswered for `retryAfterSeconds`, measured from the previous request
 * comment's creation time — GitHub's record, not this process's memory, so a
 * restarted gate neither re-asks immediately nor forgets that it already asked.
 */
export async function shouldEscalateReviewRequest(input: {
  repo: string;
  number: number;
  head: string;
  token: string;
  provider: ReviewProvider;
  attempt: number;
  retryAfterSeconds: number;
}): Promise<boolean> {
  if (input.attempt <= 1) return true;
  const previous = await findReviewRequest({
    ...input,
    attempt: input.attempt - 1,
  });
  // No previous request recorded: nothing to escalate from, so make this one.
  if (previous === null) return true;
  // A request whose creation time GitHub did not report cannot be aged. Waiting
  // forever would disable the retry silently, so treat it as due.
  if (previous.createdAt === null) return true;
  const elapsedSeconds = (Date.now() - Date.parse(previous.createdAt)) / 1000;
  return elapsedSeconds >= input.retryAfterSeconds;
}

/**
 * The first-review finding count above which a pull request has never been
 * observed to converge within three rounds.
 *
 * Measured over PRs #2259–#2308: of the six pull requests whose first review
 * returned four or more findings, none finished in three rounds (median 15,
 * worst 38), while those returning zero or one finished in a median of one.
 */
export const OVERSIZED_FIRST_REVIEW_FINDINGS = 4;

/**
 * Warn — without blocking — when the first review is large enough that this pull
 * request is unlikely to converge.
 *
 * Deliberately advisory. The signal is strong but the right response is a human
 * judgement about splitting the change, and a gate that refused the PR outright
 * would be enforcing a size rule the data does not support: splitting to very
 * small pull requests costs more CI than it saves, because per-build cost is
 * flat regardless of diff size.
 *
 * Returns whether the warning was emitted, so the caller can keep it to once per
 * gate run rather than once per poll.
 */
export function warnIfFirstReviewIsOversized(input: {
  provider: ReviewProvider;
  number: number;
  threads: readonly ReviewThread[];
}): boolean {
  const count = firstReviewFindingCount(input.threads, input.provider);
  if (count === null || count < OVERSIZED_FIRST_REVIEW_FINDINGS) return false;
  console.warn(
    `PR #${String(input.number)}: ${input.provider.displayName}'s first review raised ` +
      `${String(count)} findings. No pull request measured with four or more has ` +
      `converged within three review rounds; consider splitting this change ` +
      `rather than iterating on it.`,
  );
  return true;
}

/**
 * Ask the provider to review `head` if it is time to, returning the next
 * attempt number.
 *
 * Kept here rather than inline in the poll loop so the loop reads as "observe,
 * decide, maybe ask" — the escalation rules are their own concern, and the
 * loop's branch count is already at the linter's cap.
 *
 * The provider is never asked about a head it has already reviewed, and each
 * attempt is idempotent through its own marker, so a re-run of this step cannot
 * post a duplicate.
 */
export async function ensureReviewRequested(input: {
  repo: string;
  number: number;
  head: string;
  token: string;
  provider: ReviewProvider;
  attempt: number;
  retryAfterSeconds: number;
  reviewedCommit: string | null;
}): Promise<number> {
  if (input.attempt > MAX_REVIEW_REQUEST_ATTEMPTS) return input.attempt;
  if (input.reviewedCommit === input.head) return input.attempt;
  if (!(await shouldEscalateReviewRequest(input))) return input.attempt;

  const outcome = await requestReviewAtHead(input);
  console.log(
    JSON.stringify({
      level: "info",
      msg: `review-request-${outcome}`,
      component: "review-gate",
      provider: input.provider.id,
      repo: input.repo,
      pr: input.number,
      head_sha: input.head,
      attempt: input.attempt,
    }),
  );
  return input.attempt + 1;
}
