/**
 * Pinned versions for tools installed inside Dagger-built OCI images.
 *
 * Each entry is tracked by the Renovate custom manager defined in
 * renovate.json (managerFilePatterns includes "**\/versions.ts"). See
 * packages/homelab/src/cdk8s/src/versions.ts for annotation examples.
 */
const versions = {
  // renovate: datasource=npm
  "obsidian-headless": "0.0.8",
};

export default versions;
