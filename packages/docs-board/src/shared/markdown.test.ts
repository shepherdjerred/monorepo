import { describe, expect, test } from "bun:test";

import {
  parseMarkdownDocument,
  serializeMarkdownDocument,
} from "#shared/markdown";

const MARKDOWN = `---
id: plan-fixture
type: plan
status: in-progress
board: true
verification: human
disposition: active
---

# Fixture Plan

## Remaining

- [ ] Deploy the fixture.
- [x] Build the fixture.

## Human Verification

- Confirm the deployment.

## Comment Log

### 2026-07-19T12:00:00.000Z - Agent

Ready for review.
`;

describe("Markdown document model", () => {
  test("extracts workflow metadata from semantic sections", () => {
    const parsed = parseMarkdownDocument(MARKDOWN);

    expect(parsed.metadata.title).toBe("Fixture Plan");
    expect(parsed.metadata.h1Count).toBe(1);
    expect(parsed.metadata.remainingCount).toBe(1);
    expect(parsed.metadata.hasHumanVerification).toBe(true);
    expect(parsed.metadata.commentCount).toBe(1);
    expect(parsed.metadata.lastActivity).toBe(
      "2026-07-19T12:00:00.000Z - Agent",
    );
    expect(parsed.metadata.workflow.remainingMarkdown).toBe(
      "- [ ] Deploy the fixture.\n- [x] Build the fixture.",
    );
    expect(parsed.metadata.workflow.humanVerificationMarkdown).toBe(
      "- Confirm the deployment.",
    );
    expect(parsed.metadata.workflow.commentLogMarkdown).toContain(
      "Ready for review.",
    );
  });

  test("distinguishes missing and empty workflow sections", () => {
    const withoutWorkflow = parseMarkdownDocument(`---
id: guide-fixture
type: guide
status: complete
board: false
---

# Guide
`);
    const emptyHumanVerification = parseMarkdownDocument(`---
id: plan-empty-verification
type: plan
status: awaiting-human
board: true
verification: human
disposition: active
---

# Plan

## Human Verification
`);

    expect(withoutWorkflow.metadata.workflow).toEqual({
      humanVerificationMarkdown: null,
      remainingMarkdown: null,
      commentLogMarkdown: null,
    });
    expect(
      emptyHumanVerification.metadata.workflow.humanVerificationMarkdown,
    ).toBe("");
  });

  test("serializes frontmatter in canonical order", () => {
    const parsed = parseMarkdownDocument(MARKDOWN);
    const serialized = serializeMarkdownDocument(
      parsed.frontmatter,
      parsed.body,
    );

    expect(serialized.indexOf("id: plan-fixture")).toBeLessThan(
      serialized.indexOf("type: plan"),
    );
    expect(serialized.indexOf("type: plan")).toBeLessThan(
      serialized.indexOf("status: in-progress"),
    );
    expect(parseMarkdownDocument(serialized)).toEqual(parsed);
  });
});
