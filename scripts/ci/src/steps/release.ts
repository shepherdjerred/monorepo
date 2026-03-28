/**
 * Release-please step (main only).
 */
import { daggerStep } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function releaseStep(): BuildkiteStep {
  return daggerStep({
    label: ":bookmark: Release",
    key: "release",
    daggerCmd: "dagger call release-please --source . --gh-token env:GITHUB_TOKEN",
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
  });
}
