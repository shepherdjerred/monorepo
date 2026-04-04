/**
 * Release-please step (main only).
 *
 * Runs release-please via Dagger to create/update version bump PRs
 * and GitHub releases. Nothing depends on this step — version metadata
 * is extracted separately by extractVersionsStep (in quality.ts).
 */
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function releasePleaseStep(dependsOn?: string[]): BuildkiteStep {
  const opts: Parameters<typeof daggerStep>[0] = {
    label: ":bookmark: Release Please",
    key: "release-please",
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
