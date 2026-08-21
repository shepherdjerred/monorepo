import type { ReviewThread } from "@shepherdjerred/code-review";
import { describe, expect, test } from "bun:test";
import { assertGraphQlOk, fallbackKey } from "#lib/review/findings.ts";

const thread: ReviewThread = {
  authorLogin: "qodo-code-review",
  isResolved: false,
  isOutdated: false,
  path: null,
  line: null,
  url: null,
  priority: 1,
  title: null,
  threadId: null,
  commentId: null,
  raisedInReview: null,
};

describe("assertGraphQlOk", () => {
  test("accepts a mutation that reported no errors", () => {
    expect(() => {
      assertGraphQlOk({
        data: { resolveReviewThread: { thread: { id: "1" } } },
      });
    }).not.toThrow();
    expect(() => {
      assertGraphQlOk({ data: {}, errors: [] });
    }).not.toThrow();
  });

  test("throws on the errors GraphQL returns alongside a 200", () => {
    expect(() => {
      assertGraphQlOk({ errors: [{ message: "Resource not accessible" }] });
    }).toThrow("Resource not accessible");
  });

  test("throws on a payload it cannot read rather than calling it a success", () => {
    // The caller reports the thread resolved from the absence of a throw, so
    // an unreadable response must not pass for one.
    expect(() => {
      assertGraphQlOk("<html>502 Bad Gateway</html>");
    }).toThrow();
    expect(() => {
      assertGraphQlOk({ errors: "boom" });
    }).toThrow();
  });
});

describe("fallbackKey", () => {
  test("names the thread, so the key survives a reordered list", () => {
    // `resolve` re-lists the findings before matching, so a positional key
    // pointed at whatever landed in that slot the second time.
    expect(fallbackKey({ ...thread, threadId: "PRRT_kwDO1" }, 0)).toBe(
      fallbackKey({ ...thread, threadId: "PRRT_kwDO1" }, 7),
    );
    expect(fallbackKey({ ...thread, threadId: "PRRT_kwDO1" }, 0)).not.toBe(
      fallbackKey({ ...thread, threadId: "PRRT_kwDO2" }, 0),
    );
  });

  test("prefers the thread id over the comment it also appears in", () => {
    expect(
      fallbackKey(
        { ...thread, threadId: "PRRT_kwDO1", commentId: 5_309_425_861 },
        0,
      ),
    ).toBe("thread:PRRT_kwDO1");
  });

  test("names the comment when that is the only handle", () => {
    expect(fallbackKey({ ...thread, commentId: 5_309_425_861 }, 3)).toBe(
      "comment:5309425861",
    );
  });

  test("falls back to a position only for a finding with no surface at all", () => {
    // Nothing can be cleared on such a finding, so an unstable key cannot
    // clear the wrong one.
    expect(fallbackKey(thread, 3)).toBe("#4");
  });
});
