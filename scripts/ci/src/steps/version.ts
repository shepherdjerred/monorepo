/**
 * Version commit-back step generator.
 */
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function versionCommitBackStep(dependsOn: string[]): BuildkiteStep {
  return daggerStep({
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    daggerCmd: `dagger call version-commit-back --digests "$(buildkite-agent meta-data get image-digests)" --version "$(buildkite-agent meta-data get release-version || echo dev)" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
  });
}
