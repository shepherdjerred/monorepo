import { describe, expect, test } from "vitest";
import type { GitStatusEntry } from "#activities/data-dragon/data-dragon-diff.ts";
import {
  generatedDisallowedPaths,
  isInGeneratedDirectory,
} from "./generated-refresh.ts";

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

describe("generatedDisallowedPaths with allowed directories", () => {
  test("allows files below a directory and nothing beside it", () => {
    expect(
      generatedDisallowedPaths(
        [
          entry("data/snap/index.json"),
          entry("data/snap/matchups/a/top/b.json"),
          entry("data/snap-extra/index.json"),
          entry("data/snapshot.json"),
          entry("data/snap"),
        ],
        [],
        ["data/snap"],
      ),
    ).toEqual([
      "data/snap",
      "data/snap-extra/index.json",
      "data/snapshot.json",
    ]);
  });

  test("checks a rename's source against the same rules", () => {
    expect(
      generatedDisallowedPaths(
        [
          entry("data/snap/new.json", "data/snap/old.json"),
          entry("data/snap/moved.json", "elsewhere/old.json"),
        ],
        [],
        ["data/snap/"],
      ),
    ).toEqual(["elsewhere/old.json"]);
  });

  test("still allows exact paths beside directories", () => {
    expect(
      generatedDisallowedPaths(
        [entry("data/single.json"), entry("data/snap/index.json")],
        ["data/single.json"],
        ["data/snap"],
      ),
    ).toEqual([]);
  });
});

describe("isInGeneratedDirectory", () => {
  test("matches whole path segments only", () => {
    expect(isInGeneratedDirectory("a/b/c.json", "a/b")).toBe(true);
    expect(isInGeneratedDirectory("a/b/c.json", "a/b/")).toBe(true);
    expect(isInGeneratedDirectory("a/bc/c.json", "a/b")).toBe(false);
    expect(isInGeneratedDirectory("a/b", "a/b")).toBe(false);
  });
});
