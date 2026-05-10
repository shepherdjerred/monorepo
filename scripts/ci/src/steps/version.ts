/**
 * Version commit-back step generator.
 *
 * Collects per-image digests from Buildkite metadata (set by image push steps)
 * and commits updated version references back to the repo.
 */
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * Build the version commit-back step. Only requests digests for images the
 * pipeline actually pushed in this run — passing the static superset of
 * `IMAGE_PUSH_TARGETS ∪ INFRA_PUSH_TARGETS` would fail when (e.g.) a
 * temporal-only change skips the homelab/infra push steps.
 */
export function versionCommitBackStep(
  dependsOn: string[],
  pushedVersionKeys: readonly string[],
): BuildkiteStep {
  const keyArgs = pushedVersionKeys.map((k) => `"${k}"`).join(" ");
  return daggerStep({
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    // Version format: 2.0.0-BUILD (matches Docker image tags). Only updates Docker image entries in versions.ts.
    daggerCmd: `bash .buildkite/scripts/collect-digests.sh /tmp/digests.json ${keyArgs} && dagger call version-commit-back --digests "$(cat /tmp/digests.json)" --version "2.0.0-$BUILDKITE_BUILD_NUMBER" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
    concurrency: 1,
    concurrencyGroup: "monorepo/version-commit-back",
    priority: 1,
  });
}
