/**
 * Reading the PR's review threads off GitHub's GraphQL API and normalising each
 * one into a {@link ReviewThread}. Kept apart from the completion strategies it
 * feeds: this is the shape of GitHub's payload, not a decision about it.
 */

import { isProviderAuthor } from "./identity.ts";
import {
  arrayField,
  asRecord,
  boolField,
  numberField,
  recordField,
  stringField,
} from "./github-http.ts";
import type { ReviewProvider, ReviewThread } from "./types.ts";

export const REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 1) {
            nodes {
              author { login }
              url
              body
              pullRequestReview { id submittedAt }
            }
          }
        }
      }
    }
  }
}`;

/**
 * A thread plus the review that opened it.
 *
 * The review is carried alongside rather than on {@link ReviewThread} because a
 * thread's `raisedInReview` ordinal cannot be known from the thread alone — it
 * depends on every other review on the pull request, so it is assigned by
 * {@link attributeRaisedInReview} once all pages have been read.
 */
export type ParsedReviewThread = {
  thread: ReviewThread;
  review: { id: string; submittedAt: string | null } | null;
};

/** A provider review, including clean reviews that opened no threads. */
export type ProviderReview = {
  id: string;
  submittedAt: string | null;
  authorLogin: string | null;
};

export const REVIEW_REVIEWS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          submittedAt
          author { login }
        }
      }
    }
  }
}`;

export function parseReviewPage(payload: unknown): {
  reviews: ProviderReview[];
  hasNextPage: boolean;
  endCursor: string | null;
} {
  const payloadRecord = asRecord(payload);
  const data =
    payloadRecord === null ? null : recordField(payloadRecord, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  if (pullRequest === null) {
    throw new Error(
      "GitHub GraphQL response did not include repository.pullRequest",
    );
  }
  const reviews = recordField(pullRequest, "reviews");
  if (reviews === null) {
    throw new Error("GitHub GraphQL response did not include reviews");
  }
  const parsed = arrayField(reviews, "nodes").flatMap((rawReview) => {
    const review = asRecord(rawReview);
    if (review === null) return [];
    const id = stringField(review, "id");
    if (id === null) return [];
    const author = recordField(review, "author");
    return [
      {
        id,
        submittedAt: stringField(review, "submittedAt"),
        authorLogin: author === null ? null : stringField(author, "login"),
      },
    ];
  });
  const pageInfo = recordField(reviews, "pageInfo");
  return {
    reviews: parsed,
    hasNextPage: pageInfo !== null && boolField(pageInfo, "hasNextPage"),
    endCursor: pageInfo === null ? null : stringField(pageInfo, "endCursor"),
  };
}

export function parseThreadPage(
  payload: unknown,
  provider: ReviewProvider,
): {
  headRefOid: string | null;
  threads: ParsedReviewThread[];
  hasNextPage: boolean;
  endCursor: string | null;
} {
  const payloadRecord = asRecord(payload);
  const data =
    payloadRecord === null ? null : recordField(payloadRecord, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  if (pullRequest === null) {
    throw new Error(
      "GitHub GraphQL response did not include repository.pullRequest",
    );
  }
  const reviewThreads = recordField(pullRequest, "reviewThreads");
  if (reviewThreads === null) {
    throw new Error("GitHub GraphQL response did not include reviewThreads");
  }

  const threads: ParsedReviewThread[] = [];
  for (const rawNode of arrayField(reviewThreads, "nodes")) {
    const node = asRecord(rawNode);
    if (node === null) continue;
    const comments = recordField(node, "comments");
    const commentNodes = comments === null ? [] : arrayField(comments, "nodes");
    const firstComment = asRecord(commentNodes[0]);
    let authorLogin: string | null = null;
    let url: string | null = null;
    let priority: number | null = null;
    let title: string | null = null;
    let review: ParsedReviewThread["review"] = null;
    if (firstComment !== null) {
      const author = recordField(firstComment, "author");
      const body = stringField(firstComment, "body");
      authorLogin = author === null ? null : stringField(author, "login");
      url = stringField(firstComment, "url");
      priority = provider.parseSeverity(body);
      // A thread is addressable, so a consumer *could* re-read it — but the
      // title is what identifies this finding as the same one the provider may
      // also have rendered into its review comment, which is what stops it
      // being counted twice.
      title = provider.parseFindingTitle?.(body) ?? null;
      const pullRequestReview = recordField(firstComment, "pullRequestReview");
      if (pullRequestReview !== null) {
        const reviewId = stringField(pullRequestReview, "id");
        if (reviewId !== null) {
          review = {
            id: reviewId,
            submittedAt: stringField(pullRequestReview, "submittedAt"),
          };
        }
      }
    }
    threads.push({
      thread: {
        authorLogin,
        isResolved: boolField(node, "isResolved"),
        isOutdated: boolField(node, "isOutdated"),
        path: stringField(node, "path"),
        line: numberField(node, "line"),
        url,
        priority,
        title,
        threadId: stringField(node, "id"),
        commentId: null,
        // Assigned by attributeRaisedInReview once every page has been read.
        raisedInReview: null,
      },
      review,
    });
  }

  const pageInfo = recordField(reviewThreads, "pageInfo");
  return {
    headRefOid: stringField(pullRequest, "headRefOid"),
    threads,
    hasNextPage: pageInfo !== null && boolField(pageInfo, "hasNextPage"),
    endCursor: pageInfo === null ? null : stringField(pageInfo, "endCursor"),
  };
}

/**
 * Assign each thread the review that raised it, as an ordinal plus whether that
 * review also carried a blocking-severity finding. `providerReviews` includes
 * clean reviews with no threads, so a later finding cannot be misclassified as
 * a first-review finding just because the first review was clean.
 *
 * Only the active provider's own reviews are counted, so a human review left
 * between two provider reviews cannot shift the ordinals and silently turn a
 * first-review finding into a later-review one.
 *
 * Reviews are ordered by `submittedAt`. GitHub reports null for a review that
 * was never submitted; those sort last and keep a stable relative order, which
 * is the conservative choice — a finding that cannot be placed early is treated
 * as late, and the caller's policy already fails such findings closed.
 */
export function attributeRaisedInReview(
  parsed: readonly ParsedReviewThread[],
  provider: ReviewProvider,
  alwaysBlockingPriority: number,
  providerReviews: readonly ProviderReview[] = [],
): ReviewThread[] {
  const groups = new Map<
    string,
    { submittedAt: string | null; seenAt: number; threads: ReviewThread[] }
  >();
  for (const [index, review] of providerReviews.entries()) {
    if (!isProviderAuthor(provider, review.authorLogin)) continue;
    groups.set(review.id, {
      submittedAt: review.submittedAt,
      seenAt: index,
      threads: [],
    });
  }
  for (const [index, entry] of parsed.entries()) {
    if (entry.review === null) continue;
    if (!isProviderAuthor(provider, entry.thread.authorLogin)) continue;
    const existing = groups.get(entry.review.id);
    if (existing === undefined) {
      groups.set(entry.review.id, {
        submittedAt: entry.review.submittedAt,
        seenAt: index,
        threads: [entry.thread],
      });
      continue;
    }
    if (existing.submittedAt === null && entry.review.submittedAt !== null) {
      existing.submittedAt = entry.review.submittedAt;
    }
    existing.threads.push(entry.thread);
  }

  const ordered = [...groups.values()].sort((left, right) => {
    if (left.submittedAt === right.submittedAt)
      return left.seenAt - right.seenAt;
    if (left.submittedAt === null) return 1;
    if (right.submittedAt === null) return -1;
    return left.submittedAt.localeCompare(right.submittedAt);
  });

  for (const [index, group] of ordered.entries()) {
    const hadBlockingSeverity = group.threads.some(
      (thread) =>
        thread.priority !== null && thread.priority <= alwaysBlockingPriority,
    );
    for (const thread of group.threads) {
      thread.raisedInReview = { ordinal: index + 1, hadBlockingSeverity };
    }
  }

  return parsed.map((entry) => entry.thread);
}
