import { describe, expect, test } from "bun:test";
import { reviewCommentBoundToHead } from "./github-issue-comments.ts";

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
  test("binds when the comment names the head commit", () => {
    expect(
      reviewCommentBoundToHead({
        body: `evidence: https://github.com/o/r/blob/${HEAD}/file.ts#L1`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: null,
      }),
    ).toBe(true);
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

  test("binds when the head appears alongside other commits", () => {
    expect(
      reviewCommentBoundToHead({
        body: `old ${OLDER} and current ${HEAD}`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
        acknowledgement: null,
      }),
    ).toBe(true);
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
