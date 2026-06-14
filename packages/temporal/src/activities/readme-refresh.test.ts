import { describe, expect, test } from "bun:test";
import { parsePorcelainPaths } from "./readme-refresh.ts";

describe("parsePorcelainPaths", () => {
  test("parses unstaged modifications (leading-space XY code) without mangling the first line", () => {
    // ` M` = index status ' ' (unmodified), work-tree status 'M' (modified).
    // The leading space is part of the 2-char status code and must NOT be stripped
    // before splitting — a whole-string .trim() on the runCommand output eats it.
    const porcelain = " M README.md\n M archive/README.md\n";
    const paths = parsePorcelainPaths(porcelain);
    expect(paths).toEqual(["README.md", "archive/README.md"]);
  });

  test("parses staged modifications (M_ XY code)", () => {
    const porcelain = "M  README.md\nM  practice/README.md\n";
    const paths = parsePorcelainPaths(porcelain);
    expect(paths).toEqual(["README.md", "practice/README.md"]);
  });

  test("parses untracked files (?? XY code)", () => {
    const porcelain = "?? packages/new-pkg/_summary.md\n";
    const paths = parsePorcelainPaths(porcelain);
    expect(paths).toEqual(["packages/new-pkg/_summary.md"]);
  });

  test("handles mixed status codes including leading-space first line", () => {
    // Realistic output: first file is unstaged-modified, second is staged-added
    const porcelain =
      " M README.md\nA  archive/README.md\n?? packages/foo/_summary.md\n";
    const paths = parsePorcelainPaths(porcelain);
    expect(paths).toEqual([
      "README.md",
      "archive/README.md",
      "packages/foo/_summary.md",
    ]);
  });

  test("returns empty array for empty status output", () => {
    expect(parsePorcelainPaths("")).toEqual([]);
    expect(parsePorcelainPaths("\n")).toEqual([]);
  });
});
