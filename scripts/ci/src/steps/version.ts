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
    daggerCmd: [
      `RELEASE_VER=$(buildkite-agent meta-data get release-version --default "")`,
      `if [ -z "$RELEASE_VER" ]; then echo "No release version — skipping version commit-back"; exit 0; fi`,
      `dagger call version-commit-back --digests "$(buildkite-agent meta-data get image-digests --default "")" --version "$RELEASE_VER" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    ].join(" && "),
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
    priority: 1,
  });
}
