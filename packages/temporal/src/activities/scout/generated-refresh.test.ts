import { describe, expect, test } from "vitest";
import type { GitStatusEntry } from "#activities/data-dragon/data-dragon-diff.ts";
import { generatedDisallowedPaths } from "./generated-refresh.ts";

function entry(path: string, previousPath?: string): GitStatusEntry {
  return { statusCode: "M", path, previousPath, kind: "modified" };
}

describe("generatedDisallowedPaths", () => {
  test("allows only the listed paths, including rename sources", () => {
    expect(
      generatedDisallowedPaths(
        [
          entry("a.json"),
          entry("README.md"),
          entry("x.json", "a.json"),
          entry("y.json", "old.json"),
        ],
        ["a.json", "x.json", "y.json"],
      ),
    ).toEqual(["README.md", "old.json"]);
  });
});
