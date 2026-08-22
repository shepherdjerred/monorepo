import { describe, expect, test } from "bun:test";

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
