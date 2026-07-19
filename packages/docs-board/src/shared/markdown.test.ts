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
