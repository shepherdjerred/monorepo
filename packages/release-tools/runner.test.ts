import { CommitExclude } from "release-please/build/src/util/commit-exclude.js";
import { describe, expect, test } from "vitest";

import {
  applyExcludedPathsToConfig,
  validateReleaseCandidatePaths,
} from "./runner.ts";

test("applies the same component exclusions to the in-memory manifest", () => {
  const repositoryConfig = {
    "packages/webring": {},
    "packages/astro-opengraph-images": {
      excludePaths: ["packages/astro-opengraph-images/typedoc.json"],
    },
  };
  applyExcludedPathsToConfig(repositoryConfig, ["packages/webring"]);
  expect(repositoryConfig).toEqual({
    "packages/webring": { excludePaths: ["packages/webring"] },
    "packages/astro-opengraph-images": {
      excludePaths: ["packages/astro-opengraph-images/typedoc.json"],
    },
  });
});

test("component exclusions cover descendant files in release-please", () => {
  const commitExclude = new CommitExclude({
    "packages/webring": {
      excludePaths: ["packages/webring"],
    },
  });

  const filtered = commitExclude.excludeCommits({
    "packages/webring": [
      { files: ["packages/webring/typedoc.json"] },
      { files: ["packages/webring/src/index.ts"] },
      {
        files: [
          "packages/webring/typedoc.json",
          "packages/release-tools/runner.ts",
        ],
      },
    ],
  });

  expect(filtered["packages/webring"]).toHaveLength(0);
});

describe("release-please candidate validation", () => {
  test("accepts candidates for eligible packages", () => {
    expect(() =>
      validateReleaseCandidatePaths(
        ["packages/webring"],
        ["packages/astro-opengraph-images"],
      ),
    ).not.toThrow();
  });

  test("rejects candidates for excluded packages", () => {
    expect(() =>
      validateReleaseCandidatePaths(
        ["packages/webring", "packages/astro-opengraph-images"],
        ["packages/astro-opengraph-images"],
      ),
    ).toThrow("proposed ineligible package");
  });
});
