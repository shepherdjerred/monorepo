/**
 * Asking a provider to review the current head.
 *
 * Providers that review automatically declare `requestReview: null` and are
 * never asked. Qodo does not: it reviews a PR once, when the PR is opened, and
 * never again on its own unless push-trigger handling is enabled in its own
 * configuration. A gate that only polls therefore waits out its whole budget on
 * every push after the first, then fails a PR whose diff is fine.
 *
 * The request is idempotent through a marker naming the provider, the exact
 * head, and the attempt, so re-running a step — or a second consumer asking for
 * the same head — cannot produce a duplicate request comment.
 */

import { z } from "zod";
import { GITHUB_API_URL, getJsonWithLink, postJson } from "./github-http.ts";
import type { ReviewProvider } from "./types.ts";

/** The fields of an issue comment this module reads. */
const CommentSchema = z.object({
  body: z.string(),
  created_at: z.string().optional(),
});

/**
 * How many times one head may be asked for.
 *
 * A single request is dropped by the provider surprisingly often — measured
 * across PRs #2259–#2308, only ~64% of automated requests drew a response within
 * an hour — and nothing re-asked, so the gate polled to its deadline and a human
 * eventually re-typed the comment by hand. One retry addresses that without
 * turning a quiet provider into a comment loop.
 */
export const MAX_REVIEW_REQUEST_ATTEMPTS = 2;

/**
 * The hidden marker that makes a review request idempotent for one head and
 * attempt.
 *
 * Shared by every consumer that can trigger a review — the CI gate and the
 * PR-fleet controller — so that two of them running against the same head
 * recognise each other's request instead of each posting one.
 *
 * The first attempt deliberately keeps the original marker format. Consumers
 * that only ever ask once (the fleet controller) still recognise, and are
 * recognised by, a first request written before attempts existed.
 */
export function buildReviewRequestMarker(
  providerId: string,
  headSha: string,
  attempt = 1,
): string {
  return attempt === 1
    ? `<!-- review-request:${providerId}:${headSha} -->`
    : `<!-- review-request:${providerId}:${headSha}:${String(attempt)} -->`;
}

/**
 * The comment body for a review request: the provider's trigger command, a
 * visible line saying who asked and why, and the hidden idempotency marker.
 *
 * Assembled here rather than by each provider so the marker cannot be omitted
 * by a provider that forgets it — which would make every poll post another
 * request — and so a reader of the pull request can tell at a glance that the
 * comment is CI machinery rather than a person asking for another look.
 */
export function buildReviewRequestBody(input: {
  command: string;
  head: string;
  attempt: number;
  marker: string;
}): string {
  const attemptNote =
    input.attempt > 1
      ? ` (attempt ${String(input.attempt)} of ${String(MAX_REVIEW_REQUEST_ATTEMPTS)})`
      : "";
  return (
    `${input.command}\n\n` +
    `<sub>Automated re-review request for \`${input.head.slice(0, 7)}\`${attemptNote} ` +
    `from the CI review gate.</sub>\n${input.marker}`
  );
}

/**
 * What asking for a review came to.
 *
 * Three outcomes rather than a boolean, because "no comment was posted" covers
 * two situations a reader has to tell apart: a provider that reviews on its own
 * and is never asked, and a request that some run had already made. Logging
 * both as the latter said a marker suppressed a request that was never
 * attempted.
 */
export type ReviewRequestOutcome =
  "requested" | "already-requested" | "unsupported";

type RequestInput = {
  repo: string;
  number: number;
  head: string;
  token: string;
  provider: ReviewProvider;
  /** 1-based attempt; defaults to the first. */
  attempt?: number;
};

/**
 * When `attempt` was asked for on this pull request, or null if it never was.
 *
 * The creation time is what lets a caller decide whether a request has gone
 * unanswered long enough to escalate. Reading it from GitHub rather than
 * remembering it in-process means a gate that restarts — a retried CI job —
 * still escalates on schedule instead of restarting the clock.
 */
export async function findReviewRequest(
  input: RequestInput,
): Promise<{ createdAt: string | null } | null> {
  const marker = buildReviewRequestMarker(
    input.provider.id,
    input.head,
    input.attempt ?? 1,
  );
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?per_page=100`;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    if (!Array.isArray(payload)) {
      // Reading an unexpected shape as "no marker" would post a duplicate
      // request on every poll.
      throw new TypeError(
        `GitHub issue comments response for ${input.repo}#${String(input.number)} was not an array`,
      );
    }
    for (const item of payload) {
      const parsed = CommentSchema.safeParse(item);
      if (parsed.success && parsed.data.body.includes(marker)) {
        return { createdAt: parsed.data.created_at ?? null };
      }
    }
    url = linkNext;
  }
  return null;
}

/**
 * Ask `provider` to review `head`, unless this attempt already has been made.
 *
 * Errors propagate: a request that cannot be posted must fail the caller
 * loudly, because silently skipping it restores exactly the behaviour this
 * exists to remove — waiting out the full timeout for a review nobody asked
 * for.
 */
export async function requestReviewAtHead(
  input: RequestInput,
): Promise<ReviewRequestOutcome> {
  const strategy = input.provider.requestReview;
  if (strategy === null) return "unsupported";

  const attempt = input.attempt ?? 1;
  if ((await findReviewRequest(input)) !== null) return "already-requested";

  await postJson(
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments`,
    {
      body: buildReviewRequestBody({
        command: strategy.command,
        head: input.head,
        attempt,
        marker: buildReviewRequestMarker(
          input.provider.id,
          input.head,
          attempt,
        ),
      }),
    },
    input.token,
  );
  return "requested";
}
