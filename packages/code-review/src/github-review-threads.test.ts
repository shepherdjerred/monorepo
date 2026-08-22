import { describe, expect, test } from "vitest";
import {
  attributeRaisedInReview,
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
      },
      {
        id: "finding-review",
        submittedAt: "2026-08-22T02:00:00Z",
        authorLogin: "qodo-code-review",
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
});
