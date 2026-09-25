import { expect, test } from "vitest";
import {
  fixedCorpusForcesLane,
  globalPaths,
  lanePaths,
  selectorPathsForLane,
} from "../migration-core.ts";
import { requestedPlatformTofuApply } from "./tofu-lane-paths.ts";

test("all expected deployment lanes are modeled", () => {
  expect(Object.keys(lanePaths)).toContain("sites");
  expect(Object.keys(lanePaths)).toContain("ci-base");
  expect(Object.keys(lanePaths)).toContain("ci-playwright");
  expect(Object.keys(lanePaths)).toContain("trmnl");
  expect(lanePaths["sites"]?.length).toBeGreaterThan(
    lanePaths["site-resume"]?.length ?? 0,
  );
});

test("native lanes separate product changes and share infrastructure changes", () => {
  const hkctlPaths = selectorPathsForLane("hkctl-native");
  const quotaPaths = selectorPathsForLane("quotabar-macos");
  const taskNotesPaths = selectorPathsForLane("tasknotes-native");
  expect(hkctlPaths).toContain("packages/hkctl");
  expect(hkctlPaths).not.toContain("packages/tasknotes-macos");
  expect(quotaPaths).toContain("packages/macos-ai-subscription-tracker");
  expect(quotaPaths).not.toContain("packages/tasknotes-macos");
  expect(taskNotesPaths).toContain("packages/tasknotes-macos");
  expect(taskNotesPaths).not.toContain(
    "packages/macos-ai-subscription-tracker",
  );
  for (const sharedPath of [
    "packages/woodpecker-config-extension/src",
    "ci/scripts/macos/macos-native-preflight.ts",
    ".mise.toml",
    ".xcode-version",
    "packages/homelab/mac-ci",
  ]) {
    expect(hkctlPaths).toContain(sharedPath);
    expect(quotaPaths).toContain(sharedPath);
    expect(taskNotesPaths).toContain(sharedPath);
  }
});

test("forces every runtime-selected fixed-corpus lane", () => {
  const environment = {
    CI_IO_FIXED_CORPUS: "true",
    CI_COMMIT_BRANCH: "main",
  };
  for (const lane of ["docker-e2e", "images", "tofu"]) {
    expect(fixedCorpusForcesLane(lane, environment)).toBe(true);
  }
  for (const lane of ["argocd", "helm", "sites"]) {
    expect(fixedCorpusForcesLane(lane, environment)).toBe(false);
  }
});

test("accepts only one exact main-only platform apply request", () => {
  expect(
    requestedPlatformTofuApply({
      TOFU_PLATFORM_APPLY: "openrouter",
      CI_COMMIT_BRANCH: "main",
    }),
  ).toBe("openrouter");
  expect(requestedPlatformTofuApply({})).toBeUndefined();
  expect(() =>
    requestedPlatformTofuApply({
      TOFU_PLATFORM_APPLY: "all",
      CI_COMMIT_BRANCH: "main",
    }),
  ).toThrow("TOFU_PLATFORM_APPLY must be one of");
  expect(() =>
    requestedPlatformTofuApply({
      TOFU_PLATFORM_APPLY: "openai",
      CI_COMMIT_BRANCH: "feature/platforms",
    }),
  ).toThrow("TOFU_PLATFORM_APPLY is main-only");
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
    "scripts/lib/scout/scout-customs-artifact.ts",
    "scripts/lib/s3-static-site.ts",
    "scripts/lib/scout/scout-release-state.ts",
    "scripts/lib/scout/scout-site-stage-bucket.ts",
    "scripts/lib/scout/scout-site-storage.ts",
  ]);
});

// The handoff helpers are global because they are the seam between the image
// lane that writes the digests and every release step that reads them: a
// commit touching only one side would otherwise select neither.
test("other lanes retain global CI inputs", () => {
  const helmPaths = selectorPathsForLane("helm");
  for (const globalInput of [
    "packages/woodpecker-config-extension/src",
    "scripts/lib/ci/ci-handoff.ts",
    "scripts/lib/ci/ci-artifact.ts",
    "scripts/lib/ci/ci-environment.ts",
  ]) {
    expect(globalPaths).toContain(globalInput);
    expect(helmPaths).toContain(globalInput);
  }
  expect(selectorPathsForLane("unknown")).toBeUndefined();
});

test("release lanes include their complete imported helper closure", () => {
  expect(lanePaths["helm"]).toContain(
    "packages/homelab/scripts/helm/helm-release-core.ts",
  );
  for (const lane of ["ci-base", "ci-playwright"]) {
    expect(lanePaths[lane]).toContain("ci/scripts/images/bake-retry.ts");
    expect(lanePaths[lane]).toContain(
      "ci/scripts/images/build-ci-image-core.ts",
    );
    expect(lanePaths[lane]).toContain("ci/scripts/reporting/buildkit-env.ts");
    expect(lanePaths[lane]).toContain(
      "ci/scripts/images/update-ci-image-pin-core.ts",
    );
  }
});
