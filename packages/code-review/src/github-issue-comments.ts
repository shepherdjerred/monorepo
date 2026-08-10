import { reactionBoundToHead } from "./head-pushed-at.ts";
import {
  asRecord,
  GITHUB_API_URL,
  getJsonWithLink,
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
  if (input.provider.completion.kind !== "issue-comment") return null;
  if (input.since !== undefined) {
    const recent = await scanProviderIssueComments(input, input.since);
    if (recent !== null) return recent;
  }
  return scanProviderIssueComments(input, undefined);
}

async function scanProviderIssueComments(
  input: {
    repo: string;
    number: number;
    token: string;
    provider: ReviewProvider;
  },
  since: string | undefined,
): Promise<ReviewIssueComment | null> {
  if (input.provider.completion.kind !== "issue-comment") return null;
  const query = new URLSearchParams({ per_page: "100" });
  if (since !== undefined) query.set("since", since);
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?${query.toString()}`;
  let latest: ReviewIssueComment | null = null;
  let latestScore = Number.NEGATIVE_INFINITY;
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
      if (body?.includes(input.provider.completion.marker) !== true) continue;
      const updatedAt =
        stringField(item, "updated_at") ?? stringField(item, "created_at");
      const score = Date.parse(updatedAt ?? "");
      const normalized = Number.isFinite(score)
        ? score
        : Number.NEGATIVE_INFINITY;
      if (latest === null || normalized >= latestScore) {
        latest = {
          body,
          updatedAt,
          url: stringField(item, "html_url"),
        };
        latestScore = normalized;
      }
    }
    url = linkNext;
  }
  return latest;
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
 * Qodo anchors its evidence and code links to the commit it reviewed, so when
 * the body names any commit those links identify the reviewed head exactly.
 *
 * Only a comment reporting no findings may fall back to the timestamp. A
 * clean review has nothing to link, so it can name no commit and the push-time
 * comparison is all there is. A comment that reports findings and still names
 * no commit says nothing about which code it read — and the edit that bumped
 * its timestamp may have done no more than strike an older finding — so it
 * cannot stand as a review of this head.
 */
export function reviewCommentBoundToHead(input: {
  body: string;
  updatedAt: string | null;
  head: string;
  headPushedAt: string | null;
  reportsFindings: boolean;
}): boolean {
  const referenced = new Set(
    [...input.body.matchAll(COMMIT_SHA_PATTERN)].map((match) => match[0]),
  );
  if (referenced.size > 0) return referenced.has(input.head);
  if (input.reportsFindings) return false;
  return reactionBoundToHead(input.updatedAt, input.headPushedAt);
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
  const comment = await fetchLatestProviderIssueComment({
    repo: input.repo,
    number: input.prNumber,
    token: input.token,
    provider: input.provider,
    // A review of this head cannot predate its push, so start from there and
    // let the helper widen the scan if nothing has been touched since.
    since: input.headPushedAt ?? undefined,
  });
  const reportsFindings =
    comment === null
      ? false
      : (input.provider.parseIssueComment?.(comment).length ?? 0) > 0;
  if (
    comment !== null &&
    reviewCommentBoundToHead({
      body: comment.body,
      updatedAt: comment.updatedAt,
      head: input.head,
      headPushedAt: input.headPushedAt,
      reportsFindings,
    })
  ) {
    return {
      state: "reviewed",
      completionSignal: "issue-comment",
      reviewedCommit: input.head,
      reviewedAt: comment.updatedAt,
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
