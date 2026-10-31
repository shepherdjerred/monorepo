/**
 * Paths that force every lane to run.
 *
 * A change to CI itself must not be filtered out by a lane's narrower guard:
 * if the generator or a selector that decides what runs changed, nothing may
 * be skipped on the strength of its decision.
 *
 * Note these are repository paths, not paths inside this package — they are
 * matched against the pipeline's changed-file list.
 */
export const GLOBAL_SELECTOR_INPUTS = [
  "packages/woodpecker-config-extension/**",
  ".woodpecker/**",
  "ci/scripts/migration-core.ts",
  "ci/scripts/selectors/ci-changed.ts",
  "ci/scripts/selectors/ensure-ancestor.ts",
  "scripts/lib/json.ts",
  "scripts/ci-test-manifest.json",
  // Each reporting workspace's CI test steps, split out of the central
  // manifest so they key only their own workspace's Turbo test:ci hash.
  "**/ci-test.json",
] as const;
