import { describe, expect, test } from "bun:test";
import { isProviderAuthor } from "../identity.ts";
import type { ReviewThread } from "../types.ts";
import {
  markQodoFindingResolved,
  qodoProvider,
  parseQodoIssueComment,
} from "./qodo.ts";

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
      parseFindings: parseQodoIssueComment,
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
        title: "Consent cache",
        path: "src/telemetry.ts",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc",
        priority: 1,
      },
      {
        authorLogin: "qodo-code-review",
        isResolved: false,
        isOutdated: false,
        title: "Stale wording",
        path: "README.md",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-def",
        priority: 2,
      },
      {
        authorLogin: "qodo-code-review",
        isResolved: true,
        isOutdated: false,
        title: "Fixed finding old issue",
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

  // Qodo closes EVERY review with this block, so a fixture without it does not
  // model a real comment. Observed on PR #2177, the first genuinely clean review
  // this repository saw: the tip's `<details>` made the clean-review check
  // conclude the comment must be rendering findings, and the gate rejected a PR
  // Qodo had passed.
  const DAILY_TIP = `<!-- qodo-daily-tip:start -->

<details>
<summary> Tip of the day</summary>

<br/>

<pre>💡 Did you know, you can turn on the rule miner</pre>

<a href="https://docs.qodo.ai/tips-and-tricks">More tips ↗</a>

</details>

<img src="https://example/divider.svg" alt="Grey Divider">
<!-- qodo-daily-tip:end -->`;

  test("accepts a clean review carrying Qodo's daily-tip footer", () => {
    expect(
      parseQodoIssueComment({
        ...comment,
        body: `
<h3>Code Review by Qodo</h3>
<code>🐞 Bugs (0)</code> <code>📘 Rule violations (0)</code> <code>📎 Requirement gaps (0)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
<img src="https://example/anteater.svg" width="20%">
<h3>Great, no issues found!</h3>
Qodo reviewed your code and found no material issues that require review
<img src="https://example/divider.svg" alt="Grey Divider">
${DAILY_TIP}
`,
      }),
    ).toEqual([]);
  });

  test("still parses findings when the daily-tip footer follows them", () => {
    // The tip rides along on finding-bearing reviews too, so stripping it must
    // not disturb the findings rendered above it.
    expect(
      parseQodoIssueComment({
        ...comment,
        body: `${comment.body}
${DAILY_TIP}
`,
      }),
    ).toHaveLength(3);
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
    ).toThrow("must yield finding 2 or a restart at 1; it yielded 3 instead");
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

  test("fails closed when drift hides the final rendered finding", () => {
    // Reshaping the LAST finding's wrapper leaves 1 and 2 parsed, which is a
    // contiguous prefix, and its section still opens a numbered finding — so
    // every within-parser guard passes. Only reading the numbering with a
    // matcher the strict parser does not use proves row 3 was rendered.
    expect(() =>
      parseQodoIssueComment({
        ...comment,
        body: comment.body.replace(
          "<summary>  3. Fixed finding <s>old issue</s> ☑</summary>",
          "<strong>  3. Fixed finding <s>old issue</s> ☑</strong>",
        ),
      }),
    ).toThrow("Qodo renders 3 finding row(s) but only 2 parsed");
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

/**
 * One finding rendered twice, as a re-review leaves it: the first copy struck
 * and resolved, the second re-appended unstruck against the previous head.
 * Only the Issue Context quoting differs, which is what each case varies.
 */
function quotedCopy(
  number: number,
  summary: string,
  context: string,
  sha: string,
): string {
  return `<details>
<summary>  ${String(number)}. ${summary}</summary>
<code>[src/priors.ts[R10-12]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc)</code>
>Existence does not prove this run wrote it.
${context}
>The intent is to assert the landing.
>[src/priors.ts[10-12]](https://github.com/shepherdjerred/monorepo/blob/${sha}/src/priors.ts/#L10-L12)
></details>

<hr/>
</details>`;
}

function reviewWithQuotedContext(
  firstContext: string,
  secondContext: string,
): string {
  return `
<h3>Code Review by Qodo</h3>
<code>🐞 Bugs (1)</code> <code>📘 Rule violations (0)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
<img src="https://example/action-required.png" alt="Action required">
${quotedCopy(1, "<s>Stale artifact</s> <code>✓ Resolved</code> <code>🐞 Bug</code>", firstContext, "f4c0d5a390d7aa2ad7713f0da3de349b8e66d421")}
${quotedCopy(2, "Stale artifact <code>🐞 Bug</code>", secondContext, "52d176391dc9015d5b3a070ea025081cdd1fad85")}
`;
}

function soleFinding(body: string): ReviewThread {
  const findings = parseQodoIssueComment({ ...comment, body });
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  if (finding === undefined) throw new Error("expected one finding");
  return finding;
}

describe("markQodoFindingResolved", () => {
  test("resolves only the named finding", () => {
    const edited = markQodoFindingResolved(comment.body, "Consent cache");
    if (edited === null) throw new Error("expected an edit");
    const byTitle = new Map(
      parseQodoIssueComment({ ...comment, body: edited }).map((finding) => [
        finding.title,
        finding.isResolved,
      ]),
    );
    expect(byTitle.get("Consent cache")).toBe(true);
    expect(byTitle.get("Stale wording")).toBe(false);
  });

  test("keeps the finding's identity so re-appended copies still collapse", () => {
    // The chip form is the whole point: identityOf strips `<code>☑ …</code>`,
    // so a dismissal must not fork the finding away from the unstruck copies
    // Qodo re-appends — that would leave the older copy blocking forever.
    const body = reviewWithQuotedContext(
      ">## Issue Context",
      ">## Issue Context",
    );
    const edited = markQodoFindingResolved(body, "Stale artifact");
    if (edited === null) throw new Error("expected an edit");
    const findings = parseQodoIssueComment({ ...comment, body: edited });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.isResolved).toBe(true);
  });

  test("is idempotent on an already-resolved finding", () => {
    const once = markQodoFindingResolved(comment.body, "Consent cache");
    if (once === null) throw new Error("expected an edit");
    const twice = markQodoFindingResolved(once, "Consent cache");
    expect(twice).toBe(once);
  });

  test("returns null rather than silently no-opping an unknown title", () => {
    expect(markQodoFindingResolved(comment.body, "Not a finding")).toBeNull();
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
        title: "Consent cache",
        path: "src/telemetry.ts",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-abc",
        priority: 1,
      },
      {
        authorLogin: "qodo-code-review",
        isResolved: false,
        isOutdated: false,
        title: "Retry budget",
        path: "src/retry.ts",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-jkl",
        priority: 1,
      },
    ]);
  });

  test("collapses copies separated only by a blank blockquote line", () => {
    // Observed on PR #2174. Qodo resolved the finding and re-appended an
    // unstruck copy whose Issue Context carried one extra blank `>`
    // continuation line — invisible when rendered, and no part of the finding.
    // Collapsing whitespace leaves the marker itself behind, so the two copies
    // read as different findings and the gate blocked on the unstruck duplicate
    // of a finding Qodo had already marked resolved.
    const finding = soleFinding(
      reviewWithQuotedContext(">## Issue Context", ">\n>## Issue Context"),
    );

    // Qodo's own verdict on the finding, not on the copy it happened to strike.
    expect(finding.isResolved).toBe(true);
    expect(finding.title).toBe("Stale artifact");
  });

  test("collapses copies whose quoting differs only in nesting depth", () => {
    // Nesting is conventionally written `> >`, so a marker matched as a run of
    // `>` characters stops at the space between the levels and leaves the inner
    // one behind — the same failure the blank-line case produces, one level
    // down. Not seen in a live comment yet; it is the shape the identity claims
    // to normalize, so it is pinned rather than left to be discovered.
    const finding = soleFinding(
      reviewWithQuotedContext(">## Issue Context", "> > ## Issue Context"),
    );

    expect(finding.isResolved).toBe(true);
    expect(finding.title).toBe("Stale artifact");
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

  test("ignores unresolved copies in Qodo's previous-review archive", () => {
    const body = `
<h3>Code Review by Qodo</h3>
<code>🐞 Bugs (0)</code> <code>📘 Rule violations (0)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
<img src="https://example/remediation-recommended.png" alt="Remediation recommended">
<details>
<summary>  1. <s>Backup path mismatch</s> <code>✓ Resolved</code> <code>🐞 Bug</code></summary>
<code>[src/bootstrap.sh[R10]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-current)</code>
Current review wording after the fix.
</details>
<!-- FOLDED_SECTION_START -->
### Previous review results
<details><summary>Results up to commit abc1234</summary>
<img src="https://example/remediation-recommended.png" alt="Remediation recommended">
<details>
<summary>  1. Backup path mismatch <code>🐞 Bug</code></summary>
<code>[src/bootstrap.sh[R10]](https://github.com/shepherdjerred/monorepo/pull/1/files#diff-previous)</code>
Older unresolved wording retained for review history.
</details>
</details>
`;

    expect(parseQodoIssueComment({ ...comment, body })).toEqual([
      {
        authorLogin: "qodo-code-review",
        isResolved: true,
        isOutdated: false,
        title: "Backup path mismatch",
        path: "src/bootstrap.sh",
        line: null,
        url: "https://github.com/shepherdjerred/monorepo/pull/1/files#diff-current",
        priority: 2,
      },
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

function reviewBlock(sha: string): string {
  return `
<img src="https://example/action-required.png" alt="Action required">
<details>
<summary>  1. Consent cache <code>\u{1F41E} Bug</code></summary>
<code>[src/telemetry.ts[R10-12]](https://github.com/o/r/blob/${sha}/src/telemetry.ts)</code>
</details>
<details>
<summary>  2. Retry budget <code>\u{1F41E} Bug</code></summary>
<code>[src/retry.ts[R4]](https://github.com/o/r/blob/${sha}/src/retry.ts)</code>
</details>
`;
}

describe("qodo re-appended review blocks", () => {
  // Observed on PR #2079: rather than appending individual copies, Qodo
  // re-rendered the WHOLE review below the first one, numbered from 1 again.
  // The two blocks were byte-identical apart from the commit SHA embedded in
  // each evidence permalink.
  const reAppended = {
    ...comment,
    body: `
<h3>Code Review by Qodo</h3>
<code>\u{1F41E} Bugs (2)</code>
<img src="https://example/divider.svg" alt="Grey Divider">
${reviewBlock("a".repeat(40))}
${reviewBlock("b".repeat(40))}
`,
  };

  test("accepts a whole review re-appended with restarted numbering", () => {
    expect(() => parseQodoIssueComment(reAppended)).not.toThrow();
  });

  test("collapses blocks that differ only by their evidence commit", () => {
    // Without normalizing the permalink commit, each re-review would present
    // every finding as brand new and double the gate's blocking count.
    expect(parseQodoIssueComment(reAppended).map((f) => f.path)).toEqual([
      "src/telemetry.ts",
      "src/retry.ts",
    ]);
  });
});
