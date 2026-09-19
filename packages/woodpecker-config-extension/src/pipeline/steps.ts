import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";

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
    // The last known-good base for change detection. Read fails loudly when
    // the producing step did not publish it.
    'export CI_CHANGED_BASE="$(bun --no-install scripts/ci/read-ci-handoff.ts ci-changed-base)"',
    'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
    // CI is the cross-machine cache producer and consumer; developer shells
    // stay local-only to avoid large transfers over weak links.
    'export TURBO_CACHE="local:rw,remote:rw"',
    "bun --no-install run verify -- --filter='!sjer.red' --filter='!@shepherdjerred/resume' --concurrency=4 --output-logs=errors-only --summarize",
  ];
}

export function buildPipelineSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "verify",
      label: "verify",
      image: images.base,
      commands: verifyCommands(),
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
      volumes: [
        { claim: "woodpecker-bun-cache", path: "/woodpecker/bun-cache" },
        { claim: "woodpecker-uv-cache", path: "/woodpecker/uv-cache" },
      ],
    },
  ];
}
