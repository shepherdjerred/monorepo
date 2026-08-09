import { describe, expect, test } from "bun:test";
import { qodoProvider, parseQodoIssueComment } from "./qodo.ts";

const comment = {
  updatedAt: "2026-08-09T12:00:00Z",
  url: "https://github.com/shepherdjerred/monorepo/pull/1#issuecomment-1",
  body: `
<h3>Code Review by Qodo</h3>
<img src="https://example/action-required.png" alt="Action required">
<details>
<summary>  1. Consent cache <code>🐞 Bug</code></summary>
<code>[src/telemetry.ts[R10-12]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc)</code>
</details>
<img src="https://example/remediation-recommended.png" alt="Remediation recommended">
<details>
<summary>  2. Stale wording <code>📝 Documentation</code></summary>
<code>[README.md[R2]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-def)</code>
</details>
<details>
<summary>  3. Fixed finding <s>old issue</s> ☑</summary>
<code>[src/fixed.ts[R1]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-ghi)</code>
</details>
`,
};

describe("qodoProvider", () => {
  test("uses Qodo's persistent issue comment and exact bot identity", () => {
    expect(qodoProvider.authorLogins).toEqual(["qodo-code-review"]);
    expect(qodoProvider.completion).toEqual({
      kind: "issue-comment",
      marker: "<h3>Code Review by Qodo</h3>",
    });
    expect(qodoProvider.requestReview?.buildComment("marker")).toBe(
      "/review\n\nmarker",
    );
  });

  test("parses unresolved action and remediation findings", () => {
    expect(parseQodoIssueComment(comment)).toEqual([
      {
        authorLogin: "qodo-code-review",
        isResolved: false,
        isOutdated: false,
        path: "src/telemetry.ts",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc",
        priority: 1,
      },
      {
        authorLogin: "qodo-code-review",
        isResolved: false,
        isOutdated: false,
        path: "README.md",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-def",
        priority: 2,
      },
      {
        authorLogin: "qodo-code-review",
        isResolved: true,
        isOutdated: false,
        path: "src/fixed.ts",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-ghi",
        priority: 2,
      },
    ]);
  });
});
