import { describe, expect, test } from "bun:test";

import { createFrontmatter } from "./migrate-docs.ts";

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
});
