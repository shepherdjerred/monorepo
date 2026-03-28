/**
 * Version commit-back step generator.
 */
import { daggerStep } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function versionCommitBackStep(dependsOn: string[]): BuildkiteStep {
  return daggerStep({
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    daggerCmd:
      'dagger call version-commit-back --digests "$(buildkite-agent meta-data get image-digests)" --version "$(buildkite-agent meta-data get release-version || echo dev)" --gh-token env:GITHUB_TOKEN',
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
  });
}
