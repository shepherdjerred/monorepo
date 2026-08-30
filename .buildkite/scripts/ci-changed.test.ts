import { expect, test } from "vitest";
import {
  fixedCorpusForcesLane,
  globalPaths,
  lanePaths,
  selectorPathsForLane,
} from "./migration-core.ts";
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
    ".buildkite/pipeline.yml",
    ".buildkite/scripts/macos-native-preflight.ts",
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
    BUILDKITE_BRANCH: "main",
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
      BUILDKITE_BRANCH: "main",
    }),
  ).toBe("openrouter");
  expect(requestedPlatformTofuApply({})).toBeUndefined();
  expect(() =>
    requestedPlatformTofuApply({
      TOFU_PLATFORM_APPLY: "all",
      BUILDKITE_BRANCH: "main",
    }),
  ).toThrow("TOFU_PLATFORM_APPLY must be one of");
  expect(() =>
    requestedPlatformTofuApply({
      TOFU_PLATFORM_APPLY: "openai",
      BUILDKITE_BRANCH: "feature/platforms",
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
    "scripts/lib/s3-static-site.ts",
    "scripts/lib/scout-release-state.ts",
    "scripts/lib/scout-site-storage.ts",
  ]);
});

test("other lanes retain global CI inputs", () => {
  const helmPaths = selectorPathsForLane("helm");
  expect(helmPaths).toContain(".buildkite/main-bootstrap.yml");
  expect(helmPaths).toContain(".buildkite/scripts/select-main-pipeline.ts");
  expect(globalPaths).toContain(".buildkite/pipeline.yml");
  expect(globalPaths).toContain(".buildkite/scripts/buildkite-handoff.ts");
  expect(globalPaths).toContain(".buildkite/scripts/read-buildkite-handoff.ts");
  expect(helmPaths).toContain(".buildkite/scripts/buildkite-handoff.ts");
  expect(helmPaths).toContain(".buildkite/scripts/read-buildkite-handoff.ts");
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
