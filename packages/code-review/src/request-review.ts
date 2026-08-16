/**
 * Asking a provider to review the current head.
 *
 * Providers that review automatically declare `requestReview: null` and are
 * never asked. Qodo does not: it reviews a PR once, when the PR is opened, and
 * never again on its own. A gate that only polls therefore waits out its whole
 * budget on every push after the first, then fails a PR whose diff is fine.
 *
 * The request is idempotent through a marker naming the provider and the exact
 * head, so re-running a step — or a second consumer asking for the same head —
 * cannot produce a second request comment.
 */

import { z } from "zod";
import { GITHUB_API_URL, getJsonWithLink, postJson } from "./github-http.ts";
import type { ReviewProvider } from "./types.ts";

/** The only field of an issue comment this module reads. */
const CommentBodySchema = z.object({ body: z.string() });

/**
 * The hidden marker that makes a review request idempotent for one head.
 *
 * Shared by every consumer that can trigger a review — the CI gate and the
 * PR-fleet controller — so that two of them running against the same head
 * recognise each other's request instead of each posting one.
 */
export function buildReviewRequestMarker(
  providerId: string,
  headSha: string,
): string {
  return `<!-- review-request:${providerId}:${headSha} -->`;
}

/**
 * Ask `provider` to review `head`, unless it already has been asked.
 *
 * Returns whether a comment was posted. Errors propagate: a request that cannot
 * be posted must fail the caller loudly, because silently skipping it restores
 * exactly the behaviour this exists to remove — waiting out the full timeout
 * for a review nobody asked for.
 */
export async function requestReviewAtHead(input: {
  repo: string;
  number: number;
  head: string;
  token: string;
  provider: ReviewProvider;
}): Promise<boolean> {
  const strategy = input.provider.requestReview;
  if (strategy === null) return false;

  const marker = buildReviewRequestMarker(input.provider.id, input.head);
  if (await hasComment(input, marker)) return false;

  await postJson(
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments`,
    { body: strategy.buildComment(marker) },
    input.token,
  );
  return true;
}

/** Whether any comment on the PR already contains `marker`. */
async function hasComment(
  input: { repo: string; number: number; token: string },
  marker: string,
): Promise<boolean> {
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
      const parsed = CommentBodySchema.safeParse(item);
      if (parsed.success && parsed.data.body.includes(marker)) return true;
    }
    url = linkNext;
  }
  return false;
}
