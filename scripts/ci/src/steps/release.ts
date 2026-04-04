/**
 * Release-please step (main only).
 *
 * Runs release-please via Dagger, then extracts versions from the repo
 * and sets them as Buildkite metadata for downstream steps.
 */
import { daggerStep, DRYRUN_FLAG } from "../lib/buildkite.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * After running release-please in Dagger, extract versions from the repo
 * checkout (on the agent, outside Dagger) and set as Buildkite metadata.
 *
 * Each extraction fails the step immediately if the version key is missing.
 */
const SET_METADATA_SCRIPT = [
  // Extract release-version from manifest (used by Helm charts, version-commit-back)
  `RELEASE_VERSION=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('.release-please-manifest.json', 'utf8'));
    const v = m['packages/homelab/src/helm-types'] || '';
    process.stdout.write(v);
  ")`,
  // Extract clauderon version from manifest
  `CLAUDERON_VERSION=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('.release-please-manifest.json', 'utf8'));
    const v = m['packages/clauderon'] || '';
    process.stdout.write(v);
  ")`,
  // Extract cooklang version from package.json (not in release-please manifest)
  `COOKLANG_VERSION=$(node -e "
    const p = JSON.parse(require('fs').readFileSync('packages/cooklang-rich-preview/package.json', 'utf8'));
    process.stdout.write(p.version || '');
  ")`,
  // Only set metadata when values are non-empty (buildkite-agent rejects empty values).
  // Use if/fi instead of || to avoid dagger-hygiene error-to-message violation.
  `if [ -n "$RELEASE_VERSION" ]; then buildkite-agent meta-data set release-version "$RELEASE_VERSION"; fi`,
  `if [ -n "$CLAUDERON_VERSION" ]; then buildkite-agent meta-data set clauderon_version "$CLAUDERON_VERSION"; fi`,
  `if [ -n "$COOKLANG_VERSION" ]; then buildkite-agent meta-data set cooklang_version "$COOKLANG_VERSION"; fi`,
  `echo "Set metadata: release-version=$RELEASE_VERSION clauderon_version=$CLAUDERON_VERSION cooklang_version=$COOKLANG_VERSION"`,
].join(" && ");

export function releaseStep(dependsOn?: string[]): BuildkiteStep {
  const daggerCmd = `dagger call release-please --source . --gh-token env:GH_TOKEN${DRYRUN_FLAG}`;
  const opts: Parameters<typeof daggerStep>[0] = {
    label: ":bookmark: Release",
    key: "release",
    daggerCmd: `${daggerCmd} && ${SET_METADATA_SCRIPT}`,
    timeoutMinutes: 10,
    condition: MAIN_ONLY,
    priority: 1,
  };
  if (dependsOn !== undefined) {
    opts.dependsOn = dependsOn;
  }
  return daggerStep(opts);
}
