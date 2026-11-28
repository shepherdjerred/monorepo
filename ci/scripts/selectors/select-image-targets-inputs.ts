// These paths rebuild everything: they shape every image's bake, or they
// decide which images are selected and how a rebuilt candidate is classified.
// A correction to selection or classification must reconcile every target
// once: a previously omitted content change can already be inside the
// last-green base, so testing the new logic alone cannot repair that drift.
//
// Content-aware inputs are handled separately: bun.lock uses closure
// fingerprints; patches select their dependency's images; root and scripts
// manifests select by their changed keys. Any parse surprise selects all.
//
// Publication plumbing is deliberately absent: registry credentials, BuildKit
// and Docker Hub environment, digest handoffs, retention, access checks, and
// service ownership (packages/ops-model/services.json). None of it shapes an
// image's bytes, and Delivery keeps the original of any rebuilt image whose
// content did not change, so a forced rebuild cannot produce a new artifact.
// An image whose current owner holds no artifact is built regardless
// (includeMissingQualifiedImages). services.json still selects the images
// whose Dockerfiles copy it, through their ops-model closure.
export const GLOBAL_IMAGE_INPUTS = [
  // Bake defines the Dockerfile, context, arguments, cache, and output tags
  // for every application and infrastructure image.
  "docker-bake.hcl",
  // The push bake invocation, its build arguments and target expansion, and
  // the content-unchanged classification that discards rebuilt candidates.
  "ci/scripts/images/bake-images.ts",
  "ci/scripts/images/production-bake-environment.ts",
  "ci/scripts/migration-core.ts",
  // The push lane's bake invocation.
  "packages/woodpecker-config-extension/src/pipeline/lanes/artifacts.ts",
  // Selection itself, including the image base and the retained originals
  // that classification compares against.
  "ci/scripts/images/image-targets.ts",
  "ci/scripts/images/live-version-catalog.ts",
  "ci/scripts/selectors/select-image-targets.ts",
  "ci/scripts/selectors/select-image-targets-inputs.ts",
  "ci/scripts/selectors/ensure-ancestor.ts",
  "ci/scripts/selectors/select-image-targets-lockfile.ts",
  "ci/scripts/selectors/select-image-targets-manifests.ts",
  "ci/scripts/selectors/select-image-targets-pins.ts",
  "ci/scripts/selectors/select-image-targets-workspaces.ts",
];
