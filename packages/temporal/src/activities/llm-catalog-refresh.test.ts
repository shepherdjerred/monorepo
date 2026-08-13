import { describe, expect, test } from "bun:test";
import { catalogRefreshBranch } from "#activities/llm-catalog-refresh.ts";

const RUN_ID = "6f1c9d2a-3b4e-4f60-9a71-2c8d5e0f1b33";
const OTHER_RUN_ID = "a0b1c2d3-4e5f-4061-8273-94a5b6c7d8e9";

describe("catalogRefreshBranch", () => {
  test("is stable across attempts of the same workflow run", () => {
    // This is the whole point: openSeasonRefreshPr reuses an open PR by head
    // branch, so every retry of one run must land on the same branch or it
    // opens a second catalog PR.
    expect(catalogRefreshBranch(RUN_ID)).toBe(catalogRefreshBranch(RUN_ID));
  });

  test("does not depend on anything but the run id", () => {
    // A per-attempt value (a fresh UUID, a timestamp) would make these differ.
    const branches = new Set(
      Array.from({ length: 5 }, () => catalogRefreshBranch(RUN_ID)),
    );
    expect(branches.size).toBe(1);
  });

  test("gives distinct scheduled runs distinct branches", () => {
    // Otherwise a later weekly run would force-push over an open proposal PR
    // instead of opening its own.
    expect(catalogRefreshBranch(OTHER_RUN_ID)).not.toBe(
      catalogRefreshBranch(RUN_ID),
    );
  });

  test("keeps the conventional prefix", () => {
    expect(catalogRefreshBranch(RUN_ID)).toBe(
      "chore/llm-catalog-refresh-6f1c9d2a",
    );
  });
});
