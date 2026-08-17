import { describe, expect, test } from "bun:test";

import {
  auditCommentBody,
  resolveThreadOutcome,
  commentIdFromUrl,
  describeFinding,
  parseFlags,
} from "./review-findings.ts";

describe("commentIdFromUrl", () => {
  test("reads the id from a comment permalink", () => {
    expect(
      commentIdFromUrl(
        "https://github.com/shepherdjerred/monorepo/pull/2104#issuecomment-5248201871",
      ),
    ).toBe(5_248_201_871);
  });

  test("throws rather than editing an unknown comment", () => {
    // Guessing here would PATCH whatever id happened to parse.
    expect(() => commentIdFromUrl(null)).toThrow("could not read a comment id");
    expect(() =>
      commentIdFromUrl("https://github.com/o/r/pull/1#discussion_r1"),
    ).toThrow("could not read a comment id");
  });
});

describe("parseFlags", () => {
  test("reads flag values", () => {
    const flags = parseFlags(["--finding", "S3 fetch", "--reason", "fixed"]);
    expect(flags.get("finding")).toBe("S3 fetch");
    expect(flags.get("reason")).toBe("fixed");
  });

  test("rejects a flag with no value", () => {
    // `--finding --reason x` would otherwise silently dismiss a finding named
    // "--reason".
    expect(() => parseFlags(["--finding", "--reason", "x"])).toThrow(
      "--finding requires a value",
    );
  });
});

describe("describeFinding", () => {
  test("leads with severity and the finding's title", () => {
    const line = describeFinding({
      authorLogin: "qodo-code-review",
      isResolved: false,
      isOutdated: false,
      path: "packages/llm-observability/src/archive-uploader.ts",
      line: null,
      url: "https://github.com/o/r/pull/1#issuecomment-2",
      priority: 1,
      title: "S3 fetch lacks timeout",
      threadId: null,
      commentId: null,
    });
    expect(line).toContain("P1");
    expect(line).toContain("S3 fetch lacks timeout");
    expect(line).toContain("archive-uploader.ts");
  });

  test("identifies an untitled diff thread by location, not a placeholder", () => {
    const line = describeFinding({
      authorLogin: "qodo-code-review",
      isResolved: false,
      isOutdated: false,
      path: "src/x.ts",
      line: 42,
      url: null,
      priority: 2,
      title: null,
      threadId: null,
      commentId: null,
    });
    expect(line).toContain("P2 src/x.ts:42");
    expect(line).not.toContain("untitled");
  });
});

describe("graphql result handling", () => {
  test("a 200 response carrying errors is a failure, not a success", () => {
    // GitHub GraphQL reports failure in the body with HTTP 200. Trusting the
    // status alone would record an audit entry for a resolution that never
    // happened — the worst outcome, since that entry is the record someone
    // later trusts.
    expect(
      resolveThreadOutcome({
        errors: [{ message: "Could not resolve to a node" }],
      }),
    ).toBe("Could not resolve to a node");
  });

  test("a 200 response without confirmation is also a failure", () => {
    expect(resolveThreadOutcome({ data: null })).toContain("no confirmation");
    expect(resolveThreadOutcome({})).toContain("no confirmation");
  });

  test("a confirmed resolution passes", () => {
    expect(
      resolveThreadOutcome({
        data: { resolveReviewThread: { thread: { isResolved: true } } },
      }),
    ).toBeNull();
  });
});

describe("auditCommentBody", () => {
  test("records every dismissal with its reason under a stable marker", () => {
    const body = auditCommentBody([
      { finding: "S3 fetch lacks timeout", reason: "fixed in 10224eabd" },
      { finding: "Metrics gated to images", reason: "deliberate, test-pinned" },
    ]);
    expect(body).toContain("<!-- review-findings:dismissals -->");
    expect(body).toContain("**S3 fetch lacks timeout** — fixed in 10224eabd");
    expect(body).toContain(
      "**Metrics gated to images** — deliberate, test-pinned",
    );
  });
});
