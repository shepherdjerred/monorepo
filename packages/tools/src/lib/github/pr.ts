import { runGhCommand } from "./client.ts";
import type { PullRequest, Review } from "./types.ts";

export async function getPullRequest(
  prNumber: number | string,
  repo?: string
): Promise<PullRequest | null> {
  const result = await runGhCommand<PullRequest>(
    [
      "pr",
      "view",
      String(prNumber),
      "--json",
      "number,title,url,headRefName,baseRefName,state,isDraft,mergeable,reviewDecision",
    ],
    repo
  );

  if (!result.success || !result.data) {
    return null;
  }

  return result.data;
}

export async function getPullRequestForBranch(
  repo?: string
): Promise<PullRequest | null> {
  const result = await runGhCommand<PullRequest>(
    [
      "pr",
      "view",
      "--json",
      "number,title,url,headRefName,baseRefName,state,isDraft,mergeable,reviewDecision",
    ],
    repo
  );

  if (!result.success || !result.data) {
    return null;
  }

  return result.data;
}

export async function getReviews(
  prNumber: number | string,
  repo?: string
): Promise<Review[]> {
  const result = await runGhCommand<{ reviews: Review[] }>(
    ["pr", "view", String(prNumber), "--json", "reviews"],
    repo
  );

  if (!result.success || !result.data) {
    return [];
  }

  return result.data.reviews;
}

export async function getLatestReviewsByAuthor(
  prNumber: number | string,
  repo?: string
): Promise<Map<string, Review>> {
  const reviews = await getReviews(prNumber, repo);
  const latestByAuthor = new Map<string, Review>();

  // Sort by date and keep latest per author
  const sortedReviews = reviews.sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  for (const review of sortedReviews) {
    if (!latestByAuthor.has(review.author.login)) {
      latestByAuthor.set(review.author.login, review);
    }
  }

  return latestByAuthor;
}
