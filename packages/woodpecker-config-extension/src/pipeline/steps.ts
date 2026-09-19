import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";

/**
 * Shared cache claims mounted by step pods.
 *
 * These names are a contract with the cluster: the claims are created in
 * `packages/homelab/src/cdk8s/src/resources/woodpecker/caches.ts`, and a step
 * that names a claim which does not exist stays Pending rather than failing,
 * so a rename on either side must change both.
 */
const BUN_CACHE = {
  claim: "woodpecker-bun-cache",
  path: "/woodpecker/bun-cache",
} as const;
const UV_CACHE = {
  claim: "woodpecker-uv-cache",
  path: "/woodpecker/uv-cache",
} as const;

/**
 * The CI graph, as data.
 *
 * Ported from the Buildkite pipeline one lane at a time. Each step keeps its
 * original key so the generated workflow names, the `ci.sjer.red/step-key`
 * pod label, and any existing triage muscle memory all still line up.
 *
 * PORT STATUS: `verify` is complete. The remaining lanes (images, tofu,
 * playwright, release, macOS native) are not yet ported; until they are, this
 * service generates a strictly smaller graph than Buildkite runs, so it must
 * not be made the required status check.
 */

/**
 * Load the shared toolchain, then install exactly what the lane needs.
 *
 * `bun --no-install` throughout: a fresh pod must never trigger Bun's implicit
 * auto-install, which would silently resolve versions the lockfile does not
 * pin.
 */
function verifyCommands(): string[] {
  return [
    ". .buildkite/scripts/toolchain.sh",
    ".buildkite/scripts/bun-install.sh --frozen-lockfile",
    // CI_CHANGED_BASE arrives in the environment, resolved before this step
    // was generated. It is empty when the branch has never gone green, which
    // correctly makes turbo compare against nothing and build everything.
    'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
    // CI is the cross-machine cache producer and consumer; developer shells
    // stay local-only to avoid large transfers over weak links.
    'export TURBO_CACHE="local:rw,remote:rw"',
    "bun --no-install run verify -- --filter='!sjer.red' --filter='!@shepherdjerred/resume' --concurrency=4 --output-logs=errors-only --summarize",
  ];
}

export type PipelineInputs = {
  readonly images: CiImages;
  /**
   * Newest commit on the default branch whose pipeline succeeded, or undefined
   * when the branch has never gone green.
   */
  readonly changedBase: string | undefined;
};

export function buildPipelineSteps({
  images,
  changedBase,
}: PipelineInputs): CiStep[] {
  const sharedEnvironment = { CI_CHANGED_BASE: changedBase ?? "" };

  return [
    {
      key: "verify",
      label: "verify",
      image: images.base,
      commands: verifyCommands(),
      environment: sharedEnvironment,
      timeoutMinutes: 30,
      resources: VERIFY_TIER,
      secrets: [
        {
          secret: "ci-github-credentials",
          key: "GITHUB_DOWNLOAD_TOKEN",
          env: "GITHUB_DOWNLOAD_TOKEN",
        },
        {
          secret: "ci-turbo-cache-credentials",
          key: "TURBO_TOKEN",
          env: "TURBO_TOKEN",
        },
        {
          secret: "ci-seaweedfs-credentials",
          key: "SEAWEEDFS_DEPLOY_ACCESS_KEY_ID",
          env: "SEAWEEDFS_DEPLOY_ACCESS_KEY_ID",
        },
        {
          secret: "ci-seaweedfs-credentials",
          key: "SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY",
          env: "SEAWEEDFS_DEPLOY_SECRET_ACCESS_KEY",
        },
      ],
      volumes: [BUN_CACHE, UV_CACHE],
    },
  ];
}
