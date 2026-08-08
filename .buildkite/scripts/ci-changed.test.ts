import { expect, test } from "bun:test";
import {
  fixedCorpusForcesLane,
  globalPaths,
  lanePaths,
  selectorPathsForLane,
} from "./migration-core.ts";

test("all expected deployment lanes are modeled", () => {
  expect(Object.keys(lanePaths)).toContain("sites");
  expect(Object.keys(lanePaths)).toContain("ci-base");
  expect(Object.keys(lanePaths)).toContain("ci-playwright");
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

test("site-scout excludes global CI inputs and uses exact release libraries", () => {
  const paths = selectorPathsForLane("site-scout");
  const globalPathSet = new Set<string>(globalPaths);
  expect(paths).toBeDefined();
  expect(paths?.filter((path) => globalPathSet.has(path))).toEqual([]);
  expect(paths).not.toContain("scripts/lib");
  expect(paths).toContain("config/analytics-sites.json");
  expect(paths?.filter((path) => path.startsWith("scripts/lib/"))).toEqual([
    "scripts/lib/pin-candidates.ts",
    "scripts/lib/run.ts",
    "scripts/lib/s3-static-site.ts",
    "scripts/lib/scout-release-state.ts",
    "scripts/lib/scout-site-storage.ts",
  ]);
});

test("other lanes retain global CI inputs", () => {
  expect(selectorPathsForLane("helm")).toContain(globalPaths[0]);
  expect(selectorPathsForLane("unknown")).toBeUndefined();
});

test("release lanes include their complete imported helper closure", () => {
  expect(lanePaths["helm"]).toContain(
    "packages/homelab/scripts/helm-release-core.ts",
  );
  for (const lane of ["ci-base", "ci-playwright"]) {
    expect(lanePaths[lane]).toContain(".buildkite/scripts/bake-retry.ts");
    expect(lanePaths[lane]).toContain(
      ".buildkite/scripts/build-ci-image-core.ts",
    );
    expect(lanePaths[lane]).toContain(".buildkite/scripts/buildkit-env.ts");
    expect(lanePaths[lane]).toContain(
      ".buildkite/scripts/update-ci-image-pin-core.ts",
    );
  }
});
