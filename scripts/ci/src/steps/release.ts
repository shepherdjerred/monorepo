/**
 * Release-please step (main only).
 */
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function releaseStep(dependsOn?: string[]): BuildkiteStep {
  const opts: Parameters<typeof daggerStep>[0] = {
    label: ":bookmark: Release",
    key: "release",
    daggerCmd: `dagger call release-please --source . --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    priority: 1,
  };
  if (dependsOn !== undefined) {
    opts.dependsOn = dependsOn;
  }
  return daggerStep(opts);
}
