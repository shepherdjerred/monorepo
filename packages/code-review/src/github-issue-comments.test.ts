import { describe, expect, spyOn, test } from "bun:test";
import {
  fetchLatestProviderIssueComment,
  resolveIssueCommentReview,
  reviewCommentBoundToHead,
} from "./github-issue-comments.ts";
import type { ReviewProvider } from "./types.ts";

const HEAD = "fd6e655bd1a2f2234218a0d6ed466728abdc5dab";
const OLDER = "7cc7e40c6434dee17b20c34eea454e92095c8620";
const headPushedAt = "2026-08-10T06:50:00Z";
const afterPush = "2026-08-10T06:51:16Z";

function acknowledging(sha: string) {
  return {
    body: `[Code review](https://github.com/o/r/pull/1#issuecomment-1) by qodo was updated up to the latest commit https://github.com/o/r/commit/${sha}`,
    updatedAt: afterPush,
    url: null,
  };
}

describe("reviewCommentBoundToHead", () => {
  test("rejects a finding-bearing comment that names the head without an acknowledgement", () => {
    expect(
      reviewCommentBoundToHead({
        body: `evidence: https://github.com/o/r/blob/${HEAD}/file.ts#L1`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: null,
      }),
    ).toBe(false);
  });

  test("rejects a post-push edit that still names only the superseded commit", () => {
    expect(
      reviewCommentBoundToHead({
        body: `evidence: https://github.com/o/r/blob/${OLDER}/file.ts#L1`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: null,
      }),
    ).toBe(false);
  });

  test("falls back to the push timestamp for a clean review naming no commit", () => {
    expect(
      reviewCommentBoundToHead({
        body: "clean review, no findings",
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: false,
        acknowledgement: null,
      }),
    ).toBe(true);
    expect(
      reviewCommentBoundToHead({
        body: "clean review, no findings",
        updatedAt: "2026-08-10T06:49:00Z",
        head: HEAD,
        headPushedAt,
        reportsFindings: false,
        acknowledgement: null,
      }),
    ).toBe(false);
  });

  test("rejects findings that name no commit however recent the edit", () => {
    // Providers link a finding's code by PR-relative diff anchor, which carries
    // no commit. Striking an older finding after a push rewrites the comment
    // and bumps its timestamp without the new head being read at all.
    expect(
      reviewCommentBoundToHead({
        body: "1. Consent cache https://github.com/o/r/pull/1/files#diff-abcR10-R12",
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: null,
      }),
    ).toBe(false);
  });

  test("reads a body with no commit at all without throwing", () => {
    // `matchAll` yields an empty iterator here. `String.match` would return
    // null instead, which is the shape that makes this path look unsafe.
    expect(() =>
      reviewCommentBoundToHead({
        body: "no shas here",
        updatedAt: null,
        head: HEAD,
        headPushedAt: null,
        reportsFindings: false,
        acknowledgement: null,
      }),
    ).not.toThrow();
  });

  test("rejects a finding-bearing comment that names the head among other commits", () => {
    expect(
      reviewCommentBoundToHead({
        body: `old ${OLDER} and current ${HEAD}`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: null,
      }),
    ).toBe(false);
  });

  test("binds PR-relative findings once the provider acknowledges the head", () => {
    // Without an acknowledgement this comment is unreviewable forever: its
    // findings link no commit, so resolving every one of them still leaves the
    // gate waiting for a signal the comment can never carry.
    expect(
      reviewCommentBoundToHead({
        body: "1. Consent cache https://github.com/o/r/pull/1/files#diff-abcR10-R12",
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: acknowledging(HEAD),
      }),
    ).toBe(true);
  });

  test("rejects a review relinked to the head that the provider has not acknowledged", () => {
    // Providers rewrite the review comment's links to the new head within
    // seconds of a push, before re-reading the code. The acknowledgement still
    // names the commit actually read, so it must override those links.
    expect(
      reviewCommentBoundToHead({
        body: `evidence: https://github.com/o/r/blob/${HEAD}/file.ts#L1`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: acknowledging(OLDER),
      }),
    ).toBe(false);
  });

  test("rejects a clean review whose acknowledgement names an older commit", () => {
    // The timestamp fallback must not outrank an explicit acknowledgement.
    expect(
      reviewCommentBoundToHead({
        body: "clean review, no findings",
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: false,
        acknowledgement: acknowledging(OLDER),
      }),
    ).toBe(false);
  });
});

const issueCommentProvider: ReviewProvider = {
  id: "issue-comment-fixture",
  displayName: "Issue comment fixture",
  botAuthoredPullRequestPolicy: "review",
  authorLogins: ["review-bot"],
  parseSeverity: () => null,
  completion: {
    kind: "issue-comment",
    marker: "review-marker",
    acknowledgement: { marker: "ack-marker" },
    inProgress: { marker: "in-progress-marker" },
    parseFindings: () => [
      {
        authorLogin: "review-bot",
        isResolved: false,
        isOutdated: false,
        path: "src/example.ts",
        line: 1,
        url: null,
        priority: 1,
      },
    ],
  },
  detectSkip: null,
  requestReview: null,
};

test("records the acknowledgement time as issue-comment completion", async () => {
  const reviewUpdatedAt = "2026-08-10T06:51:00Z";
  const acknowledgementUpdatedAt = "2026-08-10T06:52:00Z";
  const fetchImplementation = Object.assign(
    async () =>
      Response.json([
        {
          body: "review-marker with findings",
          updated_at: reviewUpdatedAt,
          html_url: "https://github.com/o/r/issues/1#issuecomment-review",
          user: { login: "review-bot" },
        },
        {
          body: `ack-marker ${HEAD}`,
          updated_at: acknowledgementUpdatedAt,
          html_url: "https://github.com/o/r/issues/1#issuecomment-ack",
          user: { login: "review-bot" },
        },
      ]),
    { preconnect: globalThis.fetch.preconnect },
  );
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    fetchImplementation,
  );
  try {
    await expect(
      resolveIssueCommentReview({
        provider: issueCommentProvider,
        repo: "o/r",
        head: HEAD,
        prNumber: 1,
        token: "token",
        headPushedAt,
      }),
    ).resolves.toMatchObject({
      state: "reviewed",
      completionSignal: "issue-comment",
      reviewedCommit: HEAD,
      reviewedAt: acknowledgementUpdatedAt,
    });
  } finally {
    fetchSpy.mockRestore();
  }
});

test("ignores the in-progress placeholder that supersedes the rendered review", async () => {
  // Qodo posts this while re-reading the head: it carries the review marker but
  // renders no findings, and it is newer than the review it supersedes. Reading
  // it as the review makes the gate parse a review that does not exist yet.
  const reviewUpdatedAt = "2026-08-10T06:51:00Z";
  const fetchImplementation = Object.assign(
    async () =>
      Response.json([
        {
          body: "review-marker with findings",
          updated_at: reviewUpdatedAt,
          html_url: "https://github.com/o/r/issues/1#issuecomment-review",
          user: { login: "review-bot" },
        },
        {
          body: "review-marker in-progress-marker superseded by a new analysis",
          updated_at: "2026-08-10T06:59:00Z",
          html_url: "https://github.com/o/r/issues/1#issuecomment-placeholder",
          user: { login: "review-bot" },
        },
      ]),
    { preconnect: globalThis.fetch.preconnect },
  );
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    fetchImplementation,
  );
  try {
    const comment = await fetchLatestProviderIssueComment({
      repo: "o/r",
      number: 1,
      token: "token",
      provider: issueCommentProvider,
    });
    expect(comment?.body).toBe("review-marker with findings");
  } finally {
    fetchSpy.mockRestore();
  }
});

test("re-reads the review comment once an acknowledgement names the head", async () => {
  // The paginated scan can read the review body from an early page and the
  // acknowledgement from a later one, straddling a re-review that finished
  // mid-scan. The gate must block on a body that postdates the acknowledgement,
  // not the render that preceded it.
  const staleBody = "review-marker stale render";
  const freshBody = "review-marker fresh render";
  let call = 0;
  const fetchImplementation = Object.assign(
    async () => {
      call += 1;
      // First scan: the pre-re-review body plus the new acknowledgement.
      // Any later read sees the re-rendered comment.
      const reviewBody = call === 1 ? staleBody : freshBody;
      return Response.json([
        {
          body: reviewBody,
          updated_at: "2026-08-10T06:51:00Z",
          html_url: "https://github.com/o/r/issues/1#issuecomment-review",
          user: { login: "review-bot" },
        },
        {
          body: `ack-marker ${HEAD}`,
          updated_at: "2026-08-10T06:52:00Z",
          html_url: "https://github.com/o/r/issues/1#issuecomment-ack",
          user: { login: "review-bot" },
        },
      ]);
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    fetchImplementation,
  );
  try {
    const result = await resolveIssueCommentReview({
      provider: issueCommentProvider,
      repo: "o/r",
      head: HEAD,
      prNumber: 1,
      token: "token",
      headPushedAt,
    });
    expect(result.state).toBe("reviewed");
    expect(result.issueComment?.body).toBe(freshBody);
  } finally {
    fetchSpy.mockRestore();
  }
});
