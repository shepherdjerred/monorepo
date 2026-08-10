import { describe, expect, test } from "bun:test";
import { reviewCommentBoundToHead } from "./github-issue-comments.ts";

const HEAD = "fd6e655bd1a2f2234218a0d6ed466728abdc5dab";
const OLDER = "7cc7e40c6434dee17b20c34eea454e92095c8620";
const headPushedAt = "2026-08-10T06:50:00Z";
const afterPush = "2026-08-10T06:51:16Z";

describe("reviewCommentBoundToHead", () => {
  test("binds when the comment names the head commit", () => {
    expect(
      reviewCommentBoundToHead({
        body: `evidence: https://github.com/o/r/blob/${HEAD}/file.ts#L1`,
        updatedAt: afterPush,
        head: HEAD,
        headPushedAt,
        reportsFindings: true,
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
      }),
    ).toBe(true);
    expect(
      reviewCommentBoundToHead({
        body: "clean review, no findings",
        updatedAt: "2026-08-10T06:49:00Z",
        head: HEAD,
        headPushedAt,
        reportsFindings: false,
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
      }),
    ).toBe(true);
  });
});
