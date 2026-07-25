import { describe, expect, test } from "bun:test";
import { parsePorcelainPaths } from "./scout-season-refresh-git.ts";

describe("parsePorcelainPaths", () => {
  test("worktree-modified file (leading-space ` M` prefix) keeps its full path", () => {
    // Regression: an earlier `.trim()` stripped the leading space, shifting the
    // slice one char into the path so it never matched a committed constant.
    const status =
      " M packages/frontend/src/data/generated/scout-showcase-assets.json";
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/frontend/src/data/generated/scout-showcase-assets.json",
    ]);
  });

  test("staged-modified (`M ` prefix) and untracked (`??` prefix) paths parse whole", () => {
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
    ].join("\n");
    expect(parsePorcelainPaths(status)).toEqual([
      "packages/frontend/one.png",
      "packages/frontend/two.png",
      "packages/frontend/three.json",
    ]);
  });

  test("empty output and trailing newline yield no paths", () => {
    expect(parsePorcelainPaths("")).toEqual([]);
    expect(parsePorcelainPaths(" M packages/a.ts\n")).toEqual([
      "packages/a.ts",
    ]);
  });
});
