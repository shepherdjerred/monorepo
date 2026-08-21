import { describe, expect, test } from "vitest";
import { catalogRefreshBranch } from "#activities/llm-catalog-refresh.ts";

const PROPOSAL = '{\n  "gpt-5.6-luna": { "input": 0.2 }\n}\n';
const OTHER_PROPOSAL = '{\n  "gpt-5.6-luna": { "input": 0.25 }\n}\n';

describe("catalogRefreshBranch", () => {
  test("is stable across attempts of one run", () => {
    // openSeasonRefreshPr reuses an open PR by head branch, so every retry of
    // one run must land on the same branch or it opens a second catalog PR.
    expect(catalogRefreshBranch(PROPOSAL)).toBe(catalogRefreshBranch(PROPOSAL));
  });

  test("does not depend on anything but the proposed content", () => {
    // A per-attempt value (a fresh UUID, a timestamp) would make these differ.
    const branches = new Set(
      Array.from({ length: 5 }, () => catalogRefreshBranch(PROPOSAL)),
    );
    expect(branches.size).toBe(1);
  });

  test("a later run proposing the same catalog reuses the open PR's branch", () => {
    // The weekly axis, not the retry axis: while a proposal sits unmerged,
    // main still holds the old catalog, so the next scheduled run regenerates
    // the identical diff. Keying on the run id gave that a fresh branch and
    // opened a duplicate PR for a change already awaiting review.
    expect(catalogRefreshBranch(PROPOSAL)).toBe(catalogRefreshBranch(PROPOSAL));
  });

  test("a different proposal gets its own branch", () => {
    // Otherwise a later run would force-push new numbers over a PR an operator
    // is part-way through adjudicating.
    expect(catalogRefreshBranch(OTHER_PROPOSAL)).not.toBe(
      catalogRefreshBranch(PROPOSAL),
    );
  });

  test("keeps the conventional prefix", () => {
    expect(catalogRefreshBranch(PROPOSAL)).toMatch(
      /^chore\/llm-catalog-refresh-[0-9a-f]{8}$/,
    );
  });
});
