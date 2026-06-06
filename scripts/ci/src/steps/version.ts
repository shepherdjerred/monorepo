/**
 * Version commit-back step generator.
 *
 * Collects per-image digests from Buildkite metadata (set by image push steps)
 * and commits updated version references back to the repo.
 */
import {
  daggerStep,
  DRYRUN_FLAG,
  GITHUB_APP_SECRET_ARGS,
  REPO_GIT_REF,
  DAGGER_CALL,
} from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * Inline shell to collect per-image digests from Buildkite metadata into a
 * JSON file at /tmp/digests.json.
 *
 * Previously lived in `.buildkite/scripts/collect-digests.sh`, but since the
 * BK pod no longer checks out the repo, the script file isn't available on
 * disk. The logic is short enough to inline — and BK-side `buildkite-agent
 * meta-data get` is the only thing it does, which cannot move into Dagger.
 *
 * Each image push step sets metadata at "digest:{versionKey}"; we fail loudly
 * if any requested key is missing.
 */
function collectDigestsCmd(pushedVersionKeys: readonly string[]): string {
  // Buildkite's `pipeline upload` interpolates single-`$` tokens at upload
  // time, so every shell variable used at agent runtime must use `$$` to
  // survive interpolation. Without this, `$key`/`$d`/`$first`/`$(...)`
  // get blanked out and the for-loop body fails on the first iteration
  // with "ERROR: missing digest for key " (empty $key).
  const lines = [
    `bash -c '`,
    `set -euo pipefail; `,
    `echo "{" > /tmp/digests.json; `,
    `first=1; `,
    `for key in ${pushedVersionKeys.map((k) => `"${k}"`).join(" ")}; do `,
    `  d=$$(buildkite-agent meta-data get "digest:$$key" --default ""); `,
    `  if [ -z "$$d" ]; then echo "ERROR: missing digest for key $$key" >&2; exit 1; fi; `,
    `  if [ "$$first" = "1" ]; then first=0; else echo "," >> /tmp/digests.json; fi; `,
    `  printf "  \\"%s\\": \\"%s\\"" "$$key" "$$d" >> /tmp/digests.json; `,
    `done; `,
    `echo "" >> /tmp/digests.json; `,
    `echo "}" >> /tmp/digests.json; `,
    `cat /tmp/digests.json`,
    `'`,
  ];
  return lines.join("");
}

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
  return daggerStep({
    label: ":bookmark: Version Commit-Back",
    key: "version-commit-back",
    // Version format: 2.0.0-BUILD (matches Docker image tags). Only updates Docker image entries in versions.ts.
    daggerCmd: `${collectDigestsCmd(pushedVersionKeys)} && ${DAGGER_CALL} version-commit-back --source ${REPO_GIT_REF} --digests "$(cat /tmp/digests.json)" --version "2.0.0-$BUILDKITE_BUILD_NUMBER" ${GITHUB_APP_SECRET_ARGS}${DRYRUN_FLAG}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    dependsOn,
    concurrency: 1,
    concurrencyGroup: "monorepo/version-commit-back",
    priority: 1,
  });
}
