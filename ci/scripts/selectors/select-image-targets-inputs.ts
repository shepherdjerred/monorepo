// These paths rebuild everything. Content-aware inputs are handled separately:
// bun.lock uses closure fingerprints; patches select their dependency's images.
// Root/scripts manifests select all except tooling-only devDependencies/scripts
// changes. Any parse surprise selects all. Other CI tooling is not global.
export const GLOBAL_IMAGE_INPUTS = [
  // Bake defines the Dockerfile, context, arguments, cache, and output tags
  // for every application and infrastructure image.
  "docker-bake.hcl",
  // Selector and orchestration corrections must reconcile every target once:
  // a previously omitted content change can already be inside the last-green
  // base, so testing the new selector alone cannot repair that latent drift.
  "packages/woodpecker-config-extension/src/pipeline/lanes/ci-images.ts",
  "ci/scripts/images/bake-images.ts",
  "ci/scripts/images/bake-retry.ts",
  "ci/scripts/reporting/buildkit-env.ts",
  "ci/scripts/reporting/dockerhub-env.ts",
  "scripts/lib/dockerhub-credentials.ts",
  "packages/version-catalog/src/image-registry.json",
  // The image lane writes the digest handoff every downstream release step
  // reads, so a change to the producer must rebuild every target once.
  "scripts/lib/ci/ci-handoff.ts",
  "scripts/lib/ci/published-image-release.ts",
  "ci/scripts/images/dockerhub-access.ts",
  "ci/scripts/images/image-targets.ts",
  "ci/scripts/migration-core.ts",
  "ci/scripts/images/production-bake-environment.ts",
  "ci/scripts/selectors/select-image-targets.ts",
  "ci/scripts/selectors/select-image-targets-inputs.ts",
  "ci/scripts/selectors/ensure-ancestor.ts",
  "ci/scripts/selectors/select-image-targets-lockfile.ts",
  "ci/scripts/selectors/select-image-targets-pins.ts",
  "ci/scripts/selectors/select-image-targets-workspaces.ts",
  "scripts/lib/image-pin-catalog.ts",
];
