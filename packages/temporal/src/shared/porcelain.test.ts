import { describe, expect, test } from "vitest";
import { parsePorcelainPaths } from "#shared/porcelain.ts";

// NOTE: these are the pure-function cases. They are necessary but NOT
// sufficient — every one of them passed while the real caller was mangling
// paths, because the bug lived in how the status text was *fetched*, not
// parsed. The load-bearing coverage is the temp-repo integration test in
// activities/scout-season-refresh-git.integration.test.ts.
describe("parsePorcelainPaths", () => {
  test("worktree-modified file (leading-space ` M` prefix) keeps its full path", () => {
    // ` M` = index status ' ' (unmodified), work-tree status 'M' (modified).
    // The leading space is part of the 2-char status code and must NOT be
    // stripped before splitting.
    const status = " M packages/frontend/src/data/generated/assets.json";
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/frontend/src/data/generated/assets.json",
    ]);
  });

  test("staged-modified (`M `) and untracked (`??`) paths parse whole", () => {
    const status = ["M  packages/a/staged.ts", "?? packages/b/new.ts"].join(
      "\n",
    );
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/a/staged.ts",
      "packages/b/new.ts",
    ]);
  });

  test("mixed statuses in one listing all parse correctly", () => {
    const status = [
      " M packages/frontend/one.png",
      "?? packages/frontend/two.png",
      "M  packages/frontend/three.json",
      "A  sandbox/archive/README.md",
    ].join("\n");
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/frontend/one.png",
      "packages/frontend/two.png",
      "packages/frontend/three.json",
      "sandbox/archive/README.md",
    ]);
  });

  test("empty output and trailing newlines yield no paths", () => {
    expect(parsePorcelainPaths("")).toEqual([]);
    expect(parsePorcelainPaths("\n")).toEqual([]);
    expect(parsePorcelainPaths(" M packages/a.ts\n")).toEqual([
      "packages/a.ts",
    ]);
  });
});
