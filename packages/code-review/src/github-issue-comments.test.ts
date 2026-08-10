import { describe, expect, test } from "bun:test";
import { reviewCommentBoundToHead } from "./github-issue-comments.ts";

const HEAD = "fd6e655bd1a2f2234218a0d6ed466728abdc5dab";
const OLDER = "7cc7e40c6434dee17b20c34eea454e92095c8620";
const HEAD_PUSHED_AT = "2026-08-10T06:50:00Z";
const AFTER_PUSH = "2026-08-10T06:51:16Z";

describe("reviewCommentBoundToHead", () => {
  test("binds when the comment names the head commit", () => {
    const body = `evidence: https://github.com/o/r/blob/${HEAD}/file.ts#L1`;
    expect(
      reviewCommentBoundToHead(body, AFTER_PUSH, HEAD, HEAD_PUSHED_AT),
    ).toBe(true);
  });

  test("rejects a post-push edit that still names only the superseded commit", () => {
    const body = `evidence: https://github.com/o/r/blob/${OLDER}/file.ts#L1`;
    expect(
      reviewCommentBoundToHead(body, AFTER_PUSH, HEAD, HEAD_PUSHED_AT),
    ).toBe(false);
  });

  test("falls back to the push timestamp when no commit is named", () => {
    expect(
      reviewCommentBoundToHead(
        "clean review, no findings",
        AFTER_PUSH,
        HEAD,
        HEAD_PUSHED_AT,
      ),
    ).toBe(true);
    expect(
      reviewCommentBoundToHead(
        "clean review, no findings",
        "2026-08-10T06:49:00Z",
        HEAD,
        HEAD_PUSHED_AT,
      ),
    ).toBe(false);
  });

  test("binds when the head appears alongside other commits", () => {
    const body = `old ${OLDER} and current ${HEAD}`;
    expect(
      reviewCommentBoundToHead(body, AFTER_PUSH, HEAD, HEAD_PUSHED_AT),
    ).toBe(true);
  });
});
