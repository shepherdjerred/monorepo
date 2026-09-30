/**
 * Shared review snapshots: one provider-agnostic listing partitioned per
 * provider in memory.
 *
 * Split out of `./github.ts`, which sits at the repo's max-lines cap. The
 * per-provider entry point (`fetchReviewThreads`) stays there; everything
 * that lets terminal acceptance share one snapshot across providers lives
 * here.
 */

import { graphqlRequest, splitRepo } from "./github-http.ts";
import { fetchLatestProviderIssueComment } from "./github-issue-comments.ts";
import { ALWAYS_BLOCKING_PRIORITY } from "./gate.ts";
import {
  appendReviewBodyFindings,
  attributeRaisedInReview,
  parseReviewPage,
  parseThreadPage,
  type ProviderReview,
  reviewListingPageInfo,
  REVIEW_REVIEWS_QUERY,
  REVIEW_THREADS_QUERY,
  threadListingPageInfo,
  type ParsedReviewThread,
} from "./github-review-threads.ts";
import { mergeDuplicateFindings } from "./merge-findings.ts";
import type {
  ReviewIssueComment,
  ReviewProvider,
  ReviewThread,
} from "./types.ts";

/**
 * The raw provider-agnostic listing both fetch paths share: every review
 * thread page and every review page for the PR, plus the live head. Neither
 * query filters by author — partitioning happens per provider in
 * {@link assembleProviderThreads} — so one listing serves every enabled
 * provider from the same snapshot instead of re-fetching per provider.
 */
export type ReviewListing = {
  threadPayloads: unknown[];
  reviewPayloads: unknown[];
  headRefOid: string | null;
};

export async function fetchReviewListing(input: {
  repo: string;
  number: number;
  token: string;
}): Promise<ReviewListing> {
  const { owner, name } = splitRepo(input.repo);
  const threadPayloads: unknown[] = [];
  const reviewPayloads: unknown[] = [];
  let headRefOid: string | null = null;
  let cursor: string | null = null;
  for (;;) {
    const payload = await graphqlRequest(
      REVIEW_THREADS_QUERY,
      { owner, name, number: input.number, cursor },
      input.token,
    );
    threadPayloads.push(payload);
    const pageInfo = threadListingPageInfo(payload);
    if (pageInfo.headRefOid !== null) headRefOid = pageInfo.headRefOid;
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break;
    cursor = pageInfo.endCursor;
  }
  let reviewCursor: string | null = null;
  for (;;) {
    const payload = await graphqlRequest(
      REVIEW_REVIEWS_QUERY,
      { owner, name, number: input.number, cursor: reviewCursor },
      input.token,
    );
    reviewPayloads.push(payload);
    const pageInfo = reviewListingPageInfo(payload);
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break;
    reviewCursor = pageInfo.endCursor;
  }
  return { threadPayloads, reviewPayloads, headRefOid };
}

/**
 * Assemble one provider's threads from a shared {@link ReviewListing}:
 * provider-specific severity parsing, body findings, attribution, and
 * duplicate merging.
 */
export function assembleProviderThreads(input: {
  provider: ReviewProvider;
  threadPayloads: readonly unknown[];
  reviewPayloads: readonly unknown[];
  headRefOid: string | null;
  /** Resolved issue comment; `null` means fetched, none found. */
  issueComment: ReviewIssueComment | null;
}): { threads: ReviewThread[]; headRefOid: string | null } {
  const parsed: ParsedReviewThread[] = [];
  const providerReviews: ProviderReview[] = [];
  for (const payload of input.threadPayloads) {
    parsed.push(...parseThreadPage(payload, input.provider).threads);
  }
  for (const payload of input.reviewPayloads) {
    providerReviews.push(...parseReviewPage(payload).reviews);
  }
  // Providers whose findings live partly in the review itself (CodeRabbit's
  // outside-diff sections) contribute body findings before attribution, so a
  // body finding shares its review's ordinal — and merges with its thread
  // copy — instead of drifting into a review position of its own.
  appendReviewBodyFindings(
    parsed,
    providerReviews,
    input.provider,
    input.headRefOid,
  );
  // Attribution needs every page: a thread's ordinal is its review's position
  // among all of this provider's reviews, including clean reviews that opened
  // no thread and therefore do not appear in `parsed`.
  const threads: ReviewThread[] = attributeRaisedInReview(
    parsed,
    input.provider,
    ALWAYS_BLOCKING_PRIORITY,
    providerReviews,
  );
  const { completion } = input.provider;
  if (completion.kind === "issue-comment" && input.issueComment !== null) {
    threads.push(...completion.parseFindings(input.issueComment));
  }
  return {
    threads: mergeDuplicateFindings(threads, input.provider),
    headRefOid: input.headRefOid,
  };
}

/**
 * Fetch every provider's threads from ONE shared {@link ReviewListing} so
 * terminal acceptance partitions a single snapshot instead of accepting on
 * sequentially fetched per-provider snapshots. Returns threads keyed by
 * provider id, plus the live head.
 */
export async function fetchSharedProviderThreads(input: {
  repo: string;
  number: number;
  token: string;
  providers: readonly ReviewProvider[];
}): Promise<{
  byProvider: Map<string, ReviewThread[]>;
  headRefOid: string | null;
}> {
  const listing = await fetchReviewListing(input);
  const byProvider = new Map<string, ReviewThread[]>();
  for (const provider of input.providers) {
    const comment =
      provider.completion.kind === "issue-comment"
        ? await fetchLatestProviderIssueComment({
            repo: input.repo,
            number: input.number,
            token: input.token,
            provider,
          })
        : null;
    const { threads } = assembleProviderThreads({
      provider,
      threadPayloads: listing.threadPayloads,
      reviewPayloads: listing.reviewPayloads,
      headRefOid: listing.headRefOid,
      issueComment: comment,
    });
    byProvider.set(provider.id, threads);
  }
  return { byProvider, headRefOid: listing.headRefOid };
}
