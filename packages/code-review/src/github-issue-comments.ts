import { reactionBoundToHead } from "./head-pushed-at.ts";
import {
  asRecord,
  GITHUB_API_URL,
  getJsonWithLink,
  numberField,
  recordField,
  stringField,
} from "./github-http.ts";
import { isProviderAuthor } from "./identity.ts";
import type { ReviewIssueComment, ReviewProvider } from "./types.ts";
import type { ReviewStateResult } from "./github.ts";

/**
 * The latest persistent issue comment authored by an issue-comment provider.
 *
 * `since` narrows the scan to comments updated at or after that instant. The
 * result is unchanged whenever the narrowed scan finds anything: every comment
 * it excludes is older than one it includes, so the newest match is the same
 * either way. When it finds nothing the caller's window was simply too late,
 * and the unfiltered scan below runs to answer the original question.
 *
 * GitHub returns issue comments oldest-first and, on this endpoint, ignores
 * `sort`/`direction` — asking for newest-first silently yields creation order
 * — so there is no way to stop early without a filter like this one.
 */
export async function fetchLatestProviderIssueComment(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  since?: string | undefined;
}): Promise<ReviewIssueComment | null> {
  const { review } = await fetchProviderIssueComments(input);
  return review;
}

/**
 * The provider's latest review comment and latest re-review acknowledgement,
 * from one pass over the PR's issue comments.
 */
export async function fetchProviderIssueComments(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
  since?: string | undefined;
}): Promise<ProviderIssueComments> {
  if (input.provider.completion.kind !== "issue-comment") {
    return { review: null, acknowledgement: null };
  }
  if (input.since !== undefined) {
    const recent = await scanProviderIssueComments(input, input.since);
    // The acknowledgement for this head cannot predate its push, so a narrowed
    // scan that found the review comment already holds every acknowledgement
    // that could bind it.
    if (recent.review !== null) return recent;
  }
  return scanProviderIssueComments(input, undefined);
}

type ProviderIssueComments = {
  review: ReviewIssueComment | null;
  acknowledgement: ReviewIssueComment | null;
};

async function scanProviderIssueComments(
  input: {
    repo: string;
    number: number;
    token: string;
    provider: ReviewProvider;
  },
  since: string | undefined,
): Promise<ProviderIssueComments> {
  const { completion } = input.provider;
  if (completion.kind !== "issue-comment") {
    return { review: null, acknowledgement: null };
  }
  const query = new URLSearchParams({ per_page: "100" });
  if (since !== undefined) query.set("since", since);
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?${query.toString()}`;
  const review = new LatestComment();
  const acknowledgement = new LatestComment();
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    if (!Array.isArray(payload)) {
      // Treating an unexpected shape as "no comments" would hide a GitHub
      // contract regression behind a 20-minute gate timeout.
      throw new TypeError(
        `GitHub issue comments response for ${input.repo}#${String(input.number)} was not an array`,
      );
    }
    for (const rawItem of payload) {
      const item = asRecord(rawItem);
      if (item === null) continue;
      const user = recordField(item, "user");
      const login = user === null ? null : stringField(user, "login");
      if (!isProviderAuthor(input.provider, login)) continue;
      const body = stringField(item, "body");
      if (body === null) continue;
      const updatedAt =
        stringField(item, "updated_at") ?? stringField(item, "created_at");
      const comment = {
        body,
        updatedAt,
        url: stringField(item, "html_url"),
        id: numberField(item, "id"),
      };
      // An acknowledgement quotes the review comment's title, so classify it
      // first: only a comment that is not an acknowledgement can be the review.
      if (body.includes(completion.acknowledgement.marker)) {
        acknowledgement.offer(comment);
      } else if (
        completion.inProgress !== null &&
        body.includes(completion.inProgress.marker)
      ) {
        // The provider substitutes this placeholder for its rendered review
        // while it re-reads the head, and it carries the review marker. It is
        // the newest review-marked comment for as long as the re-review runs,
        // so offering it would make the gate parse a review that does not
        // exist yet instead of waiting for the one being written.
        continue;
      } else if (body.includes(completion.marker)) {
        review.offer(comment);
      }
    }
    url = linkNext;
  }
  return { review: review.value, acknowledgement: acknowledgement.value };
}

/** The most recently updated comment offered to it. */
class LatestComment {
  value: ReviewIssueComment | null = null;
  #score = Number.NEGATIVE_INFINITY;

  offer(comment: ReviewIssueComment): void {
    const parsed = Date.parse(comment.updatedAt ?? "");
    const score = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    if (this.value !== null && score < this.#score) return;
    this.value = comment;
    this.#score = score;
  }
}

const COMMIT_SHA_PATTERN = /\b[0-9a-f]{40}\b/gu;

/**
 * Decide whether a persistent review comment describes `head`.
 *
 * Prefer the commit the comment names over its edit timestamp. Providers
 * re-render this comment on every push — including edits that only strike
 * through previously reported findings — so "edited after the head was pushed"
 * does not by itself mean "reviewed this head", and accepting it would let the
 * gate pass on a review of superseded code.
 *
 * An acknowledgement settles it outright. The provider posts one only after it
 * has read a commit, and names that commit, so it answers the question the
 * review comment cannot: the review comment's own links are rewritten to the
 * new head within seconds of a push, before the code is re-read.
 *
 * Without one, a finding-bearing review cannot be trusted. Providers can
 * rewrite the persistent comment's links to the new head before re-reading the
 * code, so even a head SHA in that mutable body is not a completion signal.
 *
 * Only a comment reporting no findings may fall back to the timestamp. A clean
 * review has no finding-bearing acknowledgement to wait for, so the push-time
 * comparison is the provider's remaining completion signal.
 */
export function reviewCommentBoundToHead(input: {
  body: string;
  updatedAt: string | null;
  head: string;
  headPushedAt: string | null;
  reportsFindings: boolean;
  acknowledgement: ReviewIssueComment | null;
}): boolean {
  // An acknowledgement is the provider's own statement that it finished reading
  // a named commit, so once it uses them it is the only trustworthy answer:
  // preferring it both admits a review whose findings link no commit and
  // refuses a findings comment merely relinked to the new head.
  if (input.acknowledgement !== null) {
    return commitsNamedBy(input.acknowledgement.body).has(input.head);
  }
  if (input.reportsFindings) return false;
  return reactionBoundToHead(input.updatedAt, input.headPushedAt);
}

function commitsNamedBy(body: string): Set<string> {
  return new Set([...body.matchAll(COMMIT_SHA_PATTERN)].map(([sha]) => sha));
}

/** Resolve a persistent issue-comment review against the current head. */
export async function resolveIssueCommentReview(input: {
  provider: ReviewProvider;
  repo: string;
  head: string;
  prNumber: number;
  token: string;
  headPushedAt: string | null;
}): Promise<ReviewStateResult> {
  const scanned = await fetchProviderIssueComments({
    repo: input.repo,
    number: input.prNumber,
    token: input.token,
    provider: input.provider,
    // A review of this head cannot predate its push, so start from there and
    // let the helper widen the scan if nothing has been touched since.
    since: input.headPushedAt ?? undefined,
  });
  const { acknowledgement } = scanned;
  // The scan walks pages, so the review comment and the acknowledgement can
  // come from different pages and straddle a re-review that finished mid-scan:
  // an early page yields the body as it was rendered BEFORE the re-review while
  // a later page yields the acknowledgement naming the current head. That pair
  // reads as reviewed, and `fetchReviewThreads` reuses the stale body, so
  // findings the re-review added would be missing when the gate passes. Once an
  // acknowledgement for this head is in hand, re-read the comment so the
  // snapshot the gate blocks on postdates it.
  const comment =
    acknowledgement !== null &&
    commitsNamedBy(acknowledgement.body).has(input.head)
      ? await fetchLatestProviderIssueComment({
          repo: input.repo,
          number: input.prNumber,
          token: input.token,
          provider: input.provider,
        })
      : scanned.review;
  const { completion } = input.provider;
  const reportsFindings =
    comment === null || completion.kind !== "issue-comment"
      ? false
      : completion.parseFindings(comment).length > 0;
  if (
    comment !== null &&
    reviewCommentBoundToHead({
      body: comment.body,
      updatedAt: comment.updatedAt,
      head: input.head,
      headPushedAt: input.headPushedAt,
      reportsFindings,
      acknowledgement,
    })
  ) {
    return {
      state: "reviewed",
      completionSignal: "issue-comment",
      reviewedCommit: input.head,
      // A finding-bearing review becomes current only when the independent
      // acknowledgement arrives. Preserve a missing acknowledgement timestamp
      // as unknown rather than reporting the earlier mutable-comment edit.
      reviewedAt:
        acknowledgement === null
          ? comment.updatedAt
          : acknowledgement.updatedAt,
      staleReaction: false,
      skipReason: null,
      issueComment: comment,
    };
  }
  return {
    state: "reviewing",
    completionSignal: "none",
    reviewedCommit: null,
    reviewedAt: comment?.updatedAt ?? null,
    staleReaction: false,
    skipReason: null,
    issueComment: comment,
  };
}
