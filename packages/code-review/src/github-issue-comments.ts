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

/** The latest persistent issue comment authored by an issue-comment provider. */
export async function fetchLatestProviderIssueComment(input: {
  repo: string;
  number: number;
  token: string;
  provider: ReviewProvider;
}): Promise<ReviewIssueComment | null> {
  if (input.provider.completion.kind !== "issue-comment") return null;
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?per_page=100`;
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
  });
  if (
    comment !== null &&
    reactionBoundToHead(comment.updatedAt, input.headPushedAt)
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
