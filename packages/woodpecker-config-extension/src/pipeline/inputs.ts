/**
 * Paths that force every lane to run.
 *
 * The Buildkite pipeline listed its own definition and every selector script in
 * each lane's `if_changed` include list, so a change to CI itself could not be
 * filtered out by a lane's narrower guard. The same reasoning applies here,
 * with the generator in place of the YAML: if the thing that decides what runs
 * changed, nothing may be skipped on the strength of its decision.
 *
 * Note these are repository paths, not paths inside this package — they are
 * matched against the pipeline's changed-file list.
 */
export const GLOBAL_SELECTOR_INPUTS = [
  "packages/woodpecker-config-extension/**",
  ".woodpecker/**",
  "scripts/lib/json.ts",
  "scripts/ci-test-manifest.json",
] as const;
