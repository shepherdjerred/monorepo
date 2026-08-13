import { describe, expect, test } from "bun:test";
import { isProviderAuthor } from "../identity.ts";
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
    expect(qodoProvider.authorLogins).toEqual([
      "qodo-code-review",
      "qodo-free-for-open-source-projects",
    ]);
    expect(qodoProvider.completion).toEqual({
      kind: "issue-comment",
      marker: "<h3>Code Review by Qodo</h3>",
      acknowledgement: { marker: "was updated up to the latest commit" },
      inProgress: { marker: "<h3>New Review Started</h3>" },
    });
    expect(qodoProvider.requestReview?.buildComment("marker")).toBe(
      "/review\n\nmarker",
    );
  });

  test("recognizes every Qodo app login without admitting look-alikes", () => {
    for (const login of [
      "qodo-code-review",
      "qodo-code-review[bot]",
      "qodo-free-for-open-source-projects",
      "qodo-free-for-open-source-projects[bot]",
      "QODO-Free-For-Open-Source-Projects",
    ]) {
      expect(isProviderAuthor(qodoProvider, login)).toBe(true);
    }
    for (const login of [
      "qodo-free-for-open-source-projects-evil",
      "not-qodo-code-review",
      "qodo",
    ]) {
      expect(isProviderAuthor(qodoProvider, login)).toBe(false);
    }
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

  test("treats categories Qodo omits from the header as zero", () => {
    expect(
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<code>📎 Requirement gaps (0)</code> <code>🎨 UX issues (0)</code> <code>🔗 Cross-repo conflicts (0)</code> ",
          "",
        ),
      }),
    ).toHaveLength(3);
  });

  test("accepts header totals that include resolved findings", () => {
    expect(
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<code>📘 Rule violations (1)</code>",
          "<code>📘 Rule violations (2)</code>",
        ),
      }),
    ).toHaveLength(3);
  });
});

describe("qodo layout guards", () => {
  test("fails closed when the header declares no recognized category", () => {
    expect(() =>
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replaceAll(/<code>[^<]*\(\d+\)<\/code>/gu, ""),
      }),
    ).toThrow("declares no recognized finding counts");
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
    ).toThrow('findings under unmodelled severity section "Critical finding"');
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
    ).toThrow('severity section "Action required" has no parseable findings');
  });

  test("fails closed when only some findings in a section parse", () => {
    // Dropping one finding's closing tag leaves its neighbour parseable, so the
    // section still opens a numbered finding and still yields an active one.
    // Only counting the openers catches that the section lost a finding.
    expect(() =>
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<summary>  2. Stale wording <code>📝 Documentation</code></summary>",
          "<summary>  2. Stale wording <code>📝 Documentation</code>",
        ),
      }),
    ).toThrow("Qodo P2 section opens 2 finding(s) but 1 parsed");
  });

  test("fails closed when changed markup hides one active finding", () => {
    // Replacing both summary tags removes the numbered opener as well as the
    // parsed finding, so the section's own opener count still agrees and the
    // neighbouring resolved finding keeps the section structurally valid.
    // Qodo's numbering is what exposes the omission: findings 1 and 3 parse
    // while 2 does not.
    expect(() =>
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<summary>  2. Stale wording <code>📝 Documentation</code></summary>",
          "<strong>  2. Stale wording <code>📝 Documentation</code></strong>",
        ),
      }),
    ).toThrow("parsing must yield finding 2; it yielded 3 instead");
  });

  test("accepts a header total that overcounts the rendered findings", () => {
    // Qodo's own comment on PR #2079 declared `Bugs (10)` while rendering nine
    // bug rows, so the header is not a lower bound on the rendered rows and
    // must not fail the gate on its own.
    expect(
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<code>🐞 Bugs (1)</code>",
          "<code>🐞 Bugs (7)</code>",
        ),
      }),
    ).toHaveLength(3);
  });

  test("accepts a fully resolved rendering without treating it as parse loss", () => {
    expect(
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replaceAll("</summary>", " ☑</summary>"),
      }),
    ).toHaveLength(3);
  });
});

describe("qodo re-review copies", () => {
  test("collapses the copies Qodo re-appends on each re-review", () => {
    // Qodo re-appends every finding on re-review and reflows the copy's
    // blockquote indentation, so identity must ignore whitespace alone.
    const reAppended = `
<h3>Code Review by Qodo</h3>
<code>🐞 Bugs (3)</code> <code>📘 Rule violations (0)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
<img src="https://example/action-required.png" alt="Action required">
<details>
<summary>  1. <s>Consent cache</s> <code>✓ Resolved</code> <code>🐞 Bug</code></summary>
<code>[src/telemetry.ts[R10-12]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc)</code>
>- drop the cache
</details>
<details>
<summary>  2. Consent cache <code>🐞 Bug</code></summary>
<code>[src/telemetry.ts[R10-12]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc)</code>
> - drop the cache
</details>
<details>
<summary>  3. Consent cache <code>🐞 Bug</code></summary>
<code>[src/telemetry.ts[R10-12]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc)</code>
>  - drop the cache
</details>
<details>
<summary>  4. Retry budget <code>🐞 Bug</code></summary>
<code>[src/retry.ts[R4]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-jkl)</code>
</details>
`;
    expect(parseQodoIssueComment({ ...comment, body: reAppended })).toEqual([
      {
        authorLogin: "qodo-code-review",
        isResolved: true,
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
        path: "src/retry.ts",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-jkl",
        priority: 1,
      },
    ]);
  });

  test("keeps same-titled findings apart when their bodies differ", () => {
    const findings = parseQodoIssueComment({
      ...comment,
      body: comment.body.replace(
        "<summary>  2. Stale wording",
        "<summary>  2. Consent cache",
      ),
    });
    expect(findings.map((finding) => finding.path)).toEqual([
      "src/telemetry.ts",
      "README.md",
      "src/fixed.ts",
    ]);
  });

  test("maps Qodo's informational tier to P3 rather than dropping it", () => {
    const findings = parseQodoIssueComment({
      ...comment,
      body: comment.body.replace(
        '<img src="https://example/remediation-recommended.png" alt="Remediation recommended">',
        '<img src="https://example/informational.png" alt="Informational">',
      ),
    });
    expect(findings.map((finding) => finding.priority)).toEqual([1, 3, 3]);
  });
});
