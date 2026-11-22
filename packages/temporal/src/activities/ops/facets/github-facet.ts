import type {
  GitHubClient,
  MergedPullRequest,
  OpenPullRequest,
} from "@shepherdjerred/ops-clients/github.ts";
import { isRenovatePullRequest } from "@shepherdjerred/ops-clients/renovate.ts";
import type {
  GitHubFacet,
  GitHubRateLimitBucket,
} from "@shepherdjerred/ops-model/facets.ts";
import {
  githubPullRequestOldestOpenAgeSeconds,
  githubPullRequestsMerged7d,
  githubPullRequestsOpen,
  githubRateLimitRemaining,
} from "#observability/metrics-ops.ts";
import { authorClass } from "#activities/ops/github.ts";
import { daysBefore, hoursSince } from "#activities/ops/ops-types.ts";

export function recordGitHubPullRequestGauges(
  open: readonly OpenPullRequest[],
  merged7d: readonly { authorClass: string }[],
  now: Date,
): void {
  githubPullRequestsOpen.reset();
  githubPullRequestOldestOpenAgeSeconds.reset();
  const oldest = new Map<string, number>();
  for (const pr of open) {
    const author = authorClass(pr.author, pr.branch);
    githubPullRequestsOpen.inc({
      author_class: author,
      draft: String(pr.draft),
    });
    if (!pr.draft) {
      const age = (now.getTime() - Date.parse(pr.createdAt)) / 1000;
      oldest.set(author, Math.max(oldest.get(author) ?? 0, age));
    }
  }
  for (const [author, age] of oldest) {
    githubPullRequestOldestOpenAgeSeconds.set({ author_class: author }, age);
  }
  githubPullRequestsMerged7d.reset();
  for (const pr of merged7d) {
    githubPullRequestsMerged7d.inc({ author_class: pr.authorClass });
  }
}

export type GitHubRateLimits = {
  graphql: GitHubRateLimitBucket | null;
  core: GitHubRateLimitBucket | null;
};

export async function safeGitHubRateLimits(
  github: Pick<GitHubClient, "rateLimits">,
): Promise<GitHubRateLimits> {
  try {
    const limits = await github.rateLimits();
    githubRateLimitRemaining.set(
      { resource: "graphql" },
      limits.graphql.remaining,
    );
    githubRateLimitRemaining.set({ resource: "core" }, limits.core.remaining);
    return {
      graphql: {
        used: limits.graphql.used,
        limit: limits.graphql.limit,
        remaining: limits.graphql.remaining,
        resetAt: limits.graphql.resetAt,
      },
      core: {
        used: limits.core.used,
        limit: limits.core.limit,
        remaining: limits.core.remaining,
        resetAt: limits.core.resetAt,
      },
    };
  } catch {
    return { graphql: null, core: null };
  }
}

export function buildGitHubFacet(input: {
  open: readonly OpenPullRequest[];
  merged30d: readonly MergedPullRequest[];
  rateLimits: GitHubRateLimits;
  now: Date;
}): GitHubFacet {
  const openPrs: GitHubFacet["openPrs"] = input.open.map((pr) => {
    const rawAge = hoursSince(pr.createdAt, input.now);
    const ageHours = Number.isFinite(rawAge)
      ? Math.max(0, Math.round(rawAge * 10) / 10)
      : 0;
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      authorLogin: pr.author?.login ?? "(deleted)",
      authorKind: authorClass(pr.author, pr.branch),
      draft: pr.draft,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      ageHours,
      branch: pr.branch,
      baseRefName: pr.baseRefName,
      checks: pr.checks,
      reviewDecision: pr.reviewDecision,
      exactHeadApproved: pr.exactHeadApproved,
      mergeable: pr.mergeable,
      labels: pr.labels,
      isRenovate: isRenovatePullRequest({
        branch: pr.branch,
        authorLogin: pr.author?.login,
      }),
    };
  });

  const weekAgoMs = daysBefore(input.now, 7).getTime();
  const mergedWithin7d = input.merged30d
    .filter((pr) => Date.parse(pr.mergedAt) >= weekAgoMs)
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt));

  const mergesByAuthor7d: Record<string, number> = {};
  const merged7d: GitHubFacet["merged7d"] = mergedWithin7d.map((pr) => {
    const authorLogin = pr.author?.login ?? "(deleted)";
    mergesByAuthor7d[authorLogin] = (mergesByAuthor7d[authorLogin] ?? 0) + 1;
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      authorLogin,
      mergedAt: pr.mergedAt,
      ...(pr.branch === undefined ? {} : { branch: pr.branch }),
    };
  });

  return {
    openPrs,
    merged7d,
    mergesByAuthor7d,
    rateLimits: input.rateLimits,
  };
}
