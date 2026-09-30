import { describe, expect, test } from "vitest";
import { coderabbitProvider, codexProvider } from "@shepherdjerred/code-review";
import { reviewFindings } from "./evidence-parsers.ts";

describe("reviewFindings", () => {
  test("rejects providers whose findings live in review bodies", () => {
    expect(coderabbitProvider.parseReviewBodyFindings).not.toBeNull();
    expect(() =>
      reviewFindings({
        threads: [],
        issueComment: null,
        provider: coderabbitProvider,
      }),
    ).toThrow(/review bodies/);
  });

  test("still combines thread and issue-comment findings for other providers", () => {
    expect(codexProvider.parseReviewBodyFindings).toBeNull();
    expect(
      reviewFindings({
        threads: [],
        issueComment: null,
        provider: codexProvider,
      }),
    ).toEqual([]);
  });
});
