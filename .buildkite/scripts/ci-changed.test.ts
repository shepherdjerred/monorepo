import { expect, test } from "bun:test";
import { fixedCorpusForcesLane, lanePaths } from "./migration-core.ts";

test("all expected deployment lanes are modeled", () => {
  expect(Object.keys(lanePaths)).toContain("sites");
  expect(Object.keys(lanePaths)).toContain("ci-image");
  expect(lanePaths["sites"]?.length).toBeGreaterThan(
    lanePaths["site-resume"]?.length ?? 0,
  );
});

test("forces every runtime-selected fixed-corpus lane", () => {
  const environment = {
    CI_IO_FIXED_CORPUS: "true",
    BUILDKITE_BRANCH: "main",
  };
  for (const lane of ["docker-e2e", "images", "tofu"]) {
    expect(fixedCorpusForcesLane(lane, environment)).toBe(true);
  }
  for (const lane of ["argocd", "helm", "sites"]) {
    expect(fixedCorpusForcesLane(lane, environment)).toBe(false);
  }
});
