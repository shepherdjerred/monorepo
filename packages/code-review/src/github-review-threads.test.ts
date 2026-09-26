import { describe, expect, test } from "vitest";
import {
  attributeRaisedInReview,
  parseReviewPage,
  type ParsedReviewThread,
  type ProviderReview,
} from "./github-review-threads.ts";
import { qodoProvider } from "./providers/qodo.ts";

describe("attributeRaisedInReview", () => {
  test("counts clean provider reviews before finding-bearing reviews", () => {
    const parsed: ParsedReviewThread[] = [
      {
        thread: {
          authorLogin: "qodo-code-review",
          isResolved: false,
          isOutdated: false,
          path: "src/example.ts",
          line: 1,
          url: null,
          priority: 2,
          title: "Example finding",
          threadId: "thread-1",
          commentId: null,
          raisedInReview: null,
        },
        review: { id: "finding-review", submittedAt: "2026-08-22T02:00:00Z" },
      },
    ];
    const providerReviews: ProviderReview[] = [
      {
        id: "clean-review",
        submittedAt: "2026-08-22T01:00:00Z",
        authorLogin: "qodo-code-review",
        body: null,
        commitOid: "abc123",
      },
      {
        id: "finding-review",
        submittedAt: "2026-08-22T02:00:00Z",
        authorLogin: "qodo-code-review",
        body: "finding body",
        commitOid: "abc123",
      },
    ];

    const [thread] = attributeRaisedInReview(
      parsed,
      qodoProvider,
      1,
      providerReviews,
    );

    expect(thread?.raisedInReview).toEqual({
      ordinal: 2,
      hadBlockingSeverity: false,
    });
  });

  test("parseReviewPage keeps review bodies and commits for body parsers", () => {
    const { reviews } = parseReviewPage({
      data: {
        repository: {
          pullRequest: {
            reviews: {
              nodes: [
                {
                  id: "review-1",
                  submittedAt: "2026-05-24T19:03:46Z",
                  body: "**Actionable comments posted: 4**",
                  commit: { oid: "abc123" },
                  author: { login: "coderabbitai[bot]" },
                },
                {
                  id: "review-2",
                  submittedAt: null,
                  body: null,
                  commit: null,
                  author: { login: "shepherdjerred" },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      },
    });
    expect(reviews).toEqual([
      {
        id: "review-1",
        submittedAt: "2026-05-24T19:03:46Z",
        authorLogin: "coderabbitai[bot]",
        body: "**Actionable comments posted: 4**",
        commitOid: "abc123",
      },
      {
        id: "review-2",
        submittedAt: null,
        authorLogin: "shepherdjerred",
        body: null,
        commitOid: null,
      },
    ]);
  });
});
