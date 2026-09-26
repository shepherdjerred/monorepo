import { describe, expect, test } from "vitest";
import {
  appendReviewBodyFindings,
  attributeRaisedInReview,
  parseReviewPage,
  type ParsedReviewThread,
  type ProviderReview,
} from "./github-review-threads.ts";
import { coderabbitProvider } from "./providers/coderabbit.ts";
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

function appended(
  reviews: ProviderReview[],
  head: string | null,
): ParsedReviewThread[] {
  const parsed: ParsedReviewThread[] = [];
  appendReviewBodyFindings(parsed, reviews, coderabbitProvider, head);
  return parsed;
}

describe("appendReviewBodyFindings", () => {
  const BODY =
    "<details>\n" +
    "<summary>⚠️ Outside diff range comments (1)</summary><blockquote>\n" +
    "<details>\n" +
    "<summary>src/example.ts (1)</summary><blockquote>\n" +
    "\n" +
    "`57-60`: _⚠️ Potential issue_ | _🟡 Minor_ | _⚡ Quick win_\n" +
    "\n" +
    "**Example finding.**\n" +
    "\n" +
    "</blockquote></details>\n";

  function review(
    overrides: Partial<ProviderReview> & { id: string },
  ): ProviderReview {
    return {
      submittedAt: "2026-05-24T19:03:46Z",
      authorLogin: "coderabbitai[bot]",
      body: BODY,
      commitOid: "abc123",
      ...overrides,
    };
  }

  test("keeps body findings from the head review current", () => {
    const [entry] = appended([review({ id: "r1" })], "abc123");
    expect(entry?.thread.isOutdated).toBe(false);
    expect(entry?.thread.priority).toBe(2);
    expect(entry?.thread.path).toBe("src/example.ts");
    expect(entry?.review?.id).toBe("r1");
  });

  test("marks body findings from older reviews outdated", () => {
    const [entry] = appended([review({ id: "r1" })], "def456");
    expect(entry?.thread.isOutdated).toBe(true);
  });

  test("stays current when the commit or head is unknown", () => {
    const [noCommit] = appended(
      [review({ id: "r1", commitOid: null })],
      "def456",
    );
    expect(noCommit?.thread.isOutdated).toBe(false);
    const [noHead] = appended([review({ id: "r1" })], null);
    expect(noHead?.thread.isOutdated).toBe(false);
  });

  test("ignores other authors and providers without a body parser", () => {
    const parsed: ParsedReviewThread[] = [];
    appendReviewBodyFindings(
      parsed,
      [review({ id: "r1", authorLogin: "shepherdjerred" })],
      coderabbitProvider,
      "abc123",
    );
    expect(parsed).toEqual([]);
    appendReviewBodyFindings(
      parsed,
      [review({ id: "r1" })],
      qodoProvider,
      "abc123",
    );
    expect(parsed).toEqual([]);
  });
});
