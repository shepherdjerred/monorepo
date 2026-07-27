import { describe, expect, test } from "bun:test";

import { parseMarkdownDocument } from "#shared/markdown";
import { FrontmatterSchema } from "#shared/schema";

import {
  createFrontmatter,
  migrateDocument,
  normalizeWorkflowSection,
} from "./migrate-docs.ts";
import { rewriteMovedReferences } from "./migration-results.ts";

describe("createFrontmatter", () => {
  test("preserves an explicit board review policy", () => {
    const frontmatter = createFrontmatter(
      "plans/fixture.md",
      {
        id: "plan-fixture",
        status: "in-progress",
        board: true,
        verification: "human",
        disposition: "blocked",
      },
      "# Fixture\n\n## Remaining\n\n- [ ] Verify manually.\n",
    );

    expect(frontmatter.verification).toBe("human");
    expect(frontmatter.disposition).toBe("blocked");
  });

  test("preserves an explicit operator action", () => {
    const frontmatter = createFrontmatter(
      "todos/fixture.md",
      {
        id: "fixture",
        status: "planned",
        board: true,
        verification: "operator",
        disposition: "active",
      },
      "# Fixture\n\n## Remaining\n\n- [ ] Approve the production change.\n",
    );

    expect(frontmatter.verification).toBe("operator");
    expect(frontmatter.disposition).toBe("blocked");
  });

  test("rejects operator actions that are not blocked", () => {
    expect(() =>
      FrontmatterSchema.parse({
        id: "fixture",
        type: "todo",
        status: "planned",
        board: true,
        verification: "operator",
        disposition: "deferred",
      }),
    ).toThrow("operator documents require blocked disposition");
  });

  test("repairs active document types from their canonical directory", () => {
    const frontmatter = createFrontmatter(
      "plans/fixture.md",
      {
        id: "plan-fixture",
        type: "log",
        status: "planned",
        board: true,
        verification: "agent",
        disposition: "active",
      },
      "# Fixture\n\n## Remaining\n\n- [ ] Implement it.\n",
    );

    expect(frontmatter.type).toBe("plan");
  });

  test("preserves archived types while clearing board metadata", () => {
    const frontmatter = createFrontmatter(
      "archive/completed/fixture.md",
      {
        id: "plan-fixture",
        type: "plan",
        status: "complete",
        board: true,
        verification: "agent",
        disposition: "active",
      },
      "# Fixture\n",
    );

    expect(frontmatter.type).toBe("plan");
    expect(frontmatter.board).toBe(false);
    expect(frontmatter.verification).toBeUndefined();
    expect(frontmatter.disposition).toBeUndefined();
  });

  test("repairs awaiting-human documents to require human verification", () => {
    const frontmatter = createFrontmatter(
      "plans/fixture.md",
      {
        id: "plan-fixture",
        status: "awaiting-human",
        board: true,
        verification: "agent",
        disposition: "active",
      },
      "# Fixture\n\n## Human Verification\n\n- Confirm the deployment.\n",
    );

    expect(frontmatter.verification).toBe("human");
    expect(frontmatter.disposition).toBe("active");
  });

  test("keeps completed work with an open PR in agent progress", () => {
    const frontmatter = createFrontmatter(
      "plans/fixture.md",
      {
        id: "plan-fixture",
        status: "Complete (PR open, pending merge)",
        board: true,
      },
      "# Fixture\n",
    );

    expect(frontmatter.status).toBe("in-progress");
    expect(frontmatter.verification).toBe("agent");
  });

  test("keeps post-deploy verification as agent work", () => {
    const frontmatter = createFrontmatter(
      "plans/fixture.md",
      {
        id: "plan-fixture",
        status: "Implemented, post-deploy verification pending",
        board: true,
      },
      "# Fixture\n",
    );

    expect(frontmatter.status).toBe("in-progress");
    expect(frontmatter.verification).toBe("agent");
  });

  test("recognizes explicit user acceptance", () => {
    const frontmatter = createFrontmatter(
      "plans/fixture.md",
      {
        id: "plan-fixture",
        status: "Complete, awaiting user acceptance",
        board: true,
      },
      "# Fixture\n",
    );

    expect(frontmatter.status).toBe("awaiting-human");
    expect(frontmatter.verification).toBe("human");
  });

  test("keeps legacy todo verification with the agent", () => {
    const frontmatter = createFrontmatter(
      "todos/fixture.md",
      {
        id: "fixture",
        status: "waiting-on-verification",
        board: true,
      },
      "# Fixture\n",
    );

    expect(frontmatter.status).toBe("in-progress");
    expect(frontmatter.verification).toBe("agent");
  });
});

describe("migration archival", () => {
  test("clears board metadata in the same pass that archives a document", () => {
    const result = migrateDocument(
      "plans/fixture.md",
      `---
id: plan-fixture
type: plan
status: complete
board: true
verification: agent
disposition: active
---

# Fixture
`,
    );
    const parsed = parseMarkdownDocument(result.content);

    expect(result.targetRelativePath).toBe("archive/completed/fixture.md");
    expect(parsed.frontmatter.board).toBe(false);
    expect(parsed.frontmatter.verification).toBeUndefined();
    expect(parsed.frontmatter.disposition).toBeUndefined();
  });

  test("rewrites origins and links for documents moved by the migration", () => {
    const source = migrateDocument(
      "plans/source.md",
      `---
id: plan-source
type: plan
status: complete
board: true
verification: agent
disposition: active
---

# Source

[Dependent](../todos/dependent.md)
`,
    );
    const dependent = migrateDocument(
      "todos/dependent.md",
      `---
id: dependent
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/plans/source.md
---

# Dependent

## Remaining

- [ ] Complete the follow-up.

[Source](../plans/source.md#goal)

[Unmoved](./unmoved.md)
`,
    );
    const rewritten = rewriteMovedReferences([source, dependent]);
    const rewrittenDependent = rewritten.find(
      (result) => result.relativePath === "todos/dependent.md",
    );
    if (rewrittenDependent === undefined) {
      throw new Error("dependent migration result was not found");
    }

    expect(
      parseMarkdownDocument(rewrittenDependent.content).frontmatter.origin,
    ).toBe("packages/docs/archive/completed/source.md");
    expect(rewrittenDependent.content).toContain(
      "[Source](../archive/completed/source.md#goal)",
    );
    expect(rewrittenDependent.content).toContain("[Unmoved](./unmoved.md)");
    const rewrittenSource = rewritten.find(
      (result) => result.relativePath === "plans/source.md",
    );
    if (rewrittenSource === undefined) {
      throw new Error("source migration result was not found");
    }
    expect(rewrittenSource.content).toContain(
      "[Dependent](../../todos/dependent.md)",
    );
  });
});

describe("normalizeWorkflowSection", () => {
  test("prefers an exact human-verification section over generic verification headings", () => {
    const body = [
      "# Fixture",
      "",
      "## Verification and Delivery",
      "",
      "- [x] Run automated checks.",
      "",
      "## Human Verification",
      "",
      "- [ ] Confirm the deployment.",
      "",
    ].join("\n");

    expect(
      normalizeWorkflowSection(body, "awaiting-human", true, "Fixture"),
    ).toBe(
      [
        "# Fixture",
        "",
        "## Verification and Delivery",
        "",
        "- [x] Run automated checks.",
        "",
        "## Human Verification",
        "",
        "- Confirm the deployment.",
        "",
      ].join("\n"),
    );
  });
});
