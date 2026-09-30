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
        state: "COMMENTED",
      },
      {
        id: "finding-review",
        submittedAt: "2026-08-22T02:00:00Z",
        authorLogin: "qodo-code-review",
        body: "finding body",
        commitOid: "abc123",
        state: "COMMENTED",
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
        state: null,
      },
      {
        id: "review-2",
        submittedAt: null,
        authorLogin: "shepherdjerred",
        body: null,
        commitOid: null,
        state: null,
      },
    ]);
  });
});

function appended(reviews: ProviderReview[]): ParsedReviewThread[] {
  const parsed: ParsedReviewThread[] = [];
  appendReviewBodyFindings(parsed, reviews, coderabbitProvider);
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
      state: "COMMENTED",
      ...overrides,
    };
  }

  test("keeps body findings current with no newer review", () => {
    const [entry] = appended([review({ id: "r1" })]);
    expect(entry?.thread.isOutdated).toBe(false);
    expect(entry?.thread.priority).toBe(2);
    expect(entry?.thread.path).toBe("src/example.ts");
    expect(entry?.review?.id).toBe("r1");
  });

  test("stays current across a head change the provider has not reviewed", () => {
    // An unrelated push must not retire a finding CodeRabbit has not
    // re-reviewed: the OR gate would otherwise pass on a sibling's clean
    // review over an unreviewed P0.
    const [entry] = appended([review({ id: "r1", commitOid: "abc123" })]);
    expect(entry?.thread.isOutdated).toBe(false);
  });

  test("marks body findings superseded by a newer review outdated", () => {
    const entries = appended([
      review({
        id: "r1",
        submittedAt: "2026-05-24T19:03:46Z",
        commitOid: "abc123",
      }),
      review({
        id: "r2",
        submittedAt: "2026-05-24T20:03:46Z",
        commitOid: "def456",
        body: "**Actionable comments posted: 0**",
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.thread.isOutdated).toBe(true);
    expect(entries[0]?.review?.id).toBe("r1");
  });

  test("a repeated finding stays live through its newer copy", () => {
    const entries = appended([
      review({
        id: "r1",
        submittedAt: "2026-05-24T19:03:46Z",
        commitOid: "abc123",
      }),
      review({
        id: "r2",
        submittedAt: "2026-05-24T20:03:46Z",
        commitOid: "def456",
      }),
    ]);
    expect(entries).toHaveLength(2);
    expect(
      entries.find((entry) => entry.review?.id === "r1")?.thread.isOutdated,
    ).toBe(true);
    expect(
      entries.find((entry) => entry.review?.id === "r2")?.thread.isOutdated,
    ).toBe(false);
  });

  test("a dismissed newer review supersedes nothing", () => {
    // Completion ignores dismissed reviews, so a dismissed re-review must
    // neither retire the still-live finding nor contribute its own copy:
    // otherwise the dismissal would silently drop a P0 a clean sibling
    // could then pass over.
    const entries = appended([
      review({
        id: "r1",
        submittedAt: "2026-05-24T19:03:46Z",
        commitOid: "abc123",
      }),
      review({
        id: "r2",
        submittedAt: "2026-05-24T20:03:46Z",
        commitOid: "def456",
        state: "DISMISSED",
      }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.review?.id).toBe("r1");
    expect(entries[0]?.thread.isOutdated).toBe(false);
  });

  test("stays current when a timestamp is unknown", () => {
    const [noCommit] = appended([review({ id: "r1", commitOid: null })]);
    expect(noCommit?.thread.isOutdated).toBe(false);
    const [nullOlder] = appended([
      review({ id: "r1", submittedAt: null }),
      review({ id: "r2", submittedAt: "2026-05-24T20:03:46Z", body: null }),
    ]);
    expect(nullOlder?.thread.isOutdated).toBe(false);
  });

  test("ignores other authors and providers without a body parser", () => {
    const parsed: ParsedReviewThread[] = [];
    appendReviewBodyFindings(
      parsed,
      [review({ id: "r1", authorLogin: "shepherdjerred" })],
      coderabbitProvider,
    );
    expect(parsed).toEqual([]);
    appendReviewBodyFindings(parsed, [review({ id: "r1" })], qodoProvider);
    expect(parsed).toEqual([]);
  });
});
