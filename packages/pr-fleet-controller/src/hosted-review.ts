import {
  reviewGateSkipReasonForAuthor,
  type ReviewProvider,
} from "@shepherdjerred/code-review";
import { resolveReviewState } from "@shepherdjerred/code-review/github";
import { fetchHeadPushedAt } from "@shepherdjerred/code-review/head-pushed-at";
import type { PrIdentity } from "./schemas.ts";

export async function resolveHostedReviewCompletion(options: {
  repo: string;
  provider: ReviewProvider;
  pr: PrIdentity;
  readToken: () => Promise<string>;
}): Promise<boolean> {
  const { repo, provider, pr, readToken } = options;
  if (
    reviewGateSkipReasonForAuthor({
      author: { login: pr.author, type: pr.authorType },
      provider,
    }) !== null
  ) {
    return true;
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
  return reviewState.state === "reviewed";
}
