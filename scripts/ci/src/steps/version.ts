/**
 * Version commit-back step generator.
 *
 * Collects per-image digests from Buildkite metadata (set by image push steps)
 * and commits updated version references back to the repo.
 */
import { IMAGE_PUSH_TARGETS, INFRA_PUSH_TARGETS } from "../catalog.ts";
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/** All image version keys that have digests set by push steps. */
const ALL_IMAGE_KEYS = [
  ...IMAGE_PUSH_TARGETS.map((t) => t.versionKey),
  ...INFRA_PUSH_TARGETS.map((t) => t.versionKey),
];

export function versionCommitBackStep(dependsOn: string[]): BuildkiteStep {
  const keyArgs = ALL_IMAGE_KEYS.map((k) => `"${k}"`).join(" ");
  return daggerStep({
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    daggerCmd: `bash .buildkite/scripts/collect-digests.sh /tmp/digests.json ${keyArgs} && dagger call version-commit-back --digests "$(cat /tmp/digests.json)" --version "$BUILDKITE_BUILD_NUMBER" --gh-token env:GH_TOKEN${DRYRUN_FLAG}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
    priority: 1,
  });
}
