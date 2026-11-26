import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildStackForest,
  StackTree,
  type StackPullRequest,
} from "./stack-tree.tsx";

function pr(
  number: number,
  branch: string,
  baseRefName: string,
  overrides: Partial<StackPullRequest> = {},
): StackPullRequest {
  return {
    number,
    title: `PR ${String(number)} title`,
    url: `https://github.com/example/repo/pull/${String(number)}`,
    branch,
    baseRefName,
    authorLogin: "jerred",
    draft: false,
    checks: "SUCCESS",
    reviewDecision: "APPROVED",
    exactHeadApproved: true,
    mergeable: "MERGEABLE",
    ageHours: 6,
    ...overrides,
  };
}

describe("buildStackForest & StackTree", () => {
  it("assembles git-spice chains rooted at main and standalone non-main bases", () => {
    const items: readonly StackPullRequest[] = [
      pr(102, "feat/ui", "feat/api", {
        checks: "PENDING",
        reviewDecision: "REVIEW_REQUIRED",
        exactHeadApproved: false,
        ageHours: 3,
      }),
      pr(101, "feat/api", "main", { ageHours: 14 }),
      pr(103, "feat/tests", "feat/ui", {
        draft: true,
        checks: "FAILURE",
        reviewDecision: "APPROVED",
        exactHeadApproved: false,
        mergeable: "CONFLICTING",
        ageHours: 72,
      }),
      pr(200, "hotfix/tls", "release/1.2", { ageHours: 0.5 }),
    ];

    const forest = buildStackForest(items);
    expect(forest).toHaveLength(2);
    expect(forest[0]?.pr.number).toBe(101);
    expect(forest[0]?.children[0]?.pr.number).toBe(102);
    expect(forest[0]?.children[0]?.children[0]?.pr.number).toBe(103);
    expect(forest[0]?.children[0]?.children[0]?.depth).toBe(2);
    expect(forest[1]?.pr.number).toBe(200);

    const html = renderToStaticMarkup(<StackTree pullRequests={items} />);
    expect(html).toContain("#101");
    expect(html).toContain("#102");
    expect(html).toContain("#103");
    expect(html).toContain("└─");
    expect(html).toContain("Draft");
    expect(html).toContain("Checks failing");
    expect(html).toContain("Stale approval");
    expect(html).toContain("Conflict");
    // The branch renders as no-wrap segments with `<wbr>` after each "/".
    expect(html.replaceAll(/<[^>]+>/gu, "")).toContain(
      "hotfix/tls → release/1.2",
    );
    expect(html).toContain("@jerred");
    expect(html).toContain("3.0d");
    expect(html).toContain("30m");
  });

  it("breaks cycles safely without dropping pull requests", () => {
    const cyclic = [
      pr(1, "branch-a", "branch-b"),
      pr(2, "branch-b", "branch-a"),
    ];
    const forest = buildStackForest(cyclic);
    expect(forest).toHaveLength(1);
    expect(forest[0]?.pr.number).toBe(1);
    expect(forest[0]?.children[0]?.pr.number).toBe(2);
    expect(forest[0]?.children[0]?.children).toEqual([]);
  });

  it("renders empty message when there are no open PRs", () => {
    const html = renderToStaticMarkup(
      <StackTree pullRequests={[]} emptyMessage="Queue is clear." />,
    );
    expect(html).toBe('<p class="visual-empty">Queue is clear.</p>');
  });
});
