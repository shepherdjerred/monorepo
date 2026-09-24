import {
  reviewGateSkipReasonForAuthor,
  type ReviewIssueComment,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import { resolveReviewState } from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import type { PrIdentity } from "#domain/schemas.ts";

/**
 * Whether the provider finished reviewing the head, plus the issue-comment
 * snapshot that answered it. Providers whose findings live in a persistent
 * issue comment carry them in that snapshot rather than in review threads, so
 * returning it lets the caller read findings from the exact comment revision
 * completion was decided on instead of refetching a different one.
 */
export type HostedReviewCompletion = {
  complete: boolean;
  issueComment: ReviewIssueComment | null;
  /**
   * Provider-side block slug (e.g. `"usage-limited"`) when the review cannot
   * run, or null. The controller keeps waiting — a human resolves quota out of
   * band and the review then completes — but callers can tell a blocked wait
   * apart from a review that is still running.
   */
  blockedReason: string | null;
};

export async function resolveHostedReviewCompletion(options: {
  repo: string;
  provider: ReviewProvider;
  pr: PrIdentity;
  readToken: () => Promise<string>;
}): Promise<HostedReviewCompletion> {
  const { repo, provider, pr, readToken } = options;
  if (
    reviewGateSkipReasonForAuthor({
      author: { login: pr.author, type: pr.authorType },
      provider,
    }) !== null
  ) {
    return { complete: true, issueComment: null, blockedReason: null };
  }

  const tokenOutput = await readToken();
  const token = tokenOutput.trim();
  const headPushedAt = await fetchHeadPushedAt({
    repo,
    sha: pr.headSha,
    prNumber: pr.number,
    token,
  });
  const reviewState = await resolveReviewState({
    provider,
    repo,
    head: pr.headSha,
    prNumber: pr.number,
    token,
    headPushedAt,
  });
  return {
    complete: reviewState.state === "reviewed",
    issueComment: reviewState.issueComment ?? null,
    blockedReason: reviewState.blockedReason,
  };
}
