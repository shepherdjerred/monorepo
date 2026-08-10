import { describe, expect, test } from "bun:test";
import { qodoProvider, parseQodoIssueComment } from "./qodo.ts";

const comment = {
  updatedAt: "2026-08-09T12:00:00Z",
  url: "https://github.com/shepherdjerred/monorepo/pull/1#issuecomment-1",
  body: `
<h3>Code Review by Qodo</h3>
<code>🐞 Bugs (1)</code> <code>📘 Rule violations (1)</code> <code>📎 Requirement gaps (0)</code> <code>🎨 UX issues (0)</code> <code>🔗 Cross-repo conflicts (0)</code> <code>📜 Skill insights (0)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
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

  test("recognizes Qodo's explicit clean-review layout", () => {
    expect(
      parseQodoIssueComment({
        ...comment,
        body: `
<h3>Code Review by Qodo</h3>
<code>🐞 Bugs (0)</code> <code>📘 Rule violations (0)</code> <code>📎 Requirement gaps (0)</code> <code>🎨 UX issues (0)</code> <code>🔗 Cross-repo conflicts (0)</code> <code>📜 Skill insights (0)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
<br/>
`,
      }),
    ).toEqual([]);
  });

  test("fails closed when active findings use an unknown severity layout", () => {
    expect(() =>
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          'alt="Action required"',
          'alt="Critical finding"',
        ),
      }),
    ).toThrow("declares 2 active finding(s) but 1 were parsed");
  });

  test("fails closed when finding summaries cannot be parsed", () => {
    expect(() =>
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<summary>  1. Consent cache <code>🐞 Bug</code></summary>",
          "<strong>  1. Consent cache <code>🐞 Bug</code></strong>",
        ),
      }),
    ).toThrow("declares 2 active finding(s) but 1 were parsed");
  });
});
