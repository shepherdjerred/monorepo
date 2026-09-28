import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE } from "#src/pipeline/cache.ts";
import { VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { scannerSteps } from "#src/pipeline/lanes/scanners.ts";
import { alertDashboardSteps } from "#src/pipeline/lanes/alert-dashboard.ts";
import { resumeSteps } from "#src/pipeline/lanes/resume.ts";
import { trmnlSteps } from "#src/pipeline/lanes/trmnl.ts";
import { HANDOFF_KEYS, tofuPlanSteps } from "#src/pipeline/lanes/tofu.ts";
import { playwrightSteps } from "#src/pipeline/lanes/playwright.ts";
import {
  releaseAdmissionStep,
  tofuApplySteps,
} from "#src/pipeline/lanes/tofu-apply.ts";
import { releaseChainSteps } from "#src/pipeline/lanes/release.ts";
import { ciImageSteps } from "#src/pipeline/lanes/ci-images.ts";
import { scoutSteps } from "#src/pipeline/lanes/scout.ts";
import { siteSteps } from "#src/pipeline/lanes/sites.ts";
import { macosSteps } from "#src/pipeline/lanes/macos.ts";
import { observabilityE2eSteps } from "#src/pipeline/lanes/observability-e2e.ts";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";

/**
 * The CI graph, as data.
 *
 * Ported from the Buildkite pipeline one lane at a time. Each step keeps its
 * original key so the generated workflow names, the `ci.sjer.red/step-key`
 * pod label, and any existing triage muscle memory all still line up.
 *
 * The macOS and Windows compiler image builds remain paused. Their sources
 * stay in the repository so a separate reliability decision can restore them.
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
    ". ci/scripts/toolchain.sh",
    "ci/scripts/bun-install.sh --frozen-lockfile",
    'if [ "$CI_PIPELINE_EVENT" = "pull_request" ]; then',
    // Deepen the PR head separately, then fetch its target last so FETCH_HEAD
    // unambiguously names the target branch for the merge-base calculation.
    '  if git fetch --no-tags --depth=100 origin "$CI_COMMIT_SHA" && git fetch --no-tags --depth=100 origin "$CI_COMMIT_TARGET_BRANCH"; then',
    '    if ! CI_CHANGED_BASE="$(git merge-base HEAD FETCH_HEAD)"; then CI_CHANGED_BASE=""; fi',
    "  else",
    '    CI_CHANGED_BASE=""',
    "  fi",
    "  export CI_CHANGED_BASE",
    "fi",
    // CI_CHANGED_BASE arrives in the environment, resolved before this step
    // was generated. It is empty when the branch has never gone green, which
    // correctly makes turbo compare against nothing and build everything.
    'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE" TASKNOTES_COVERAGE_BASE="$CI_CHANGED_BASE"; fi',
    // CI is the cross-machine cache producer and consumer; developer shells
    // stay local-only to avoid large transfers over weak links.
    'export TURBO_CACHE="local:rw,remote:rw"',
    "bun --no-install run verify -- --filter='!sjer.red' --filter='!@shepherdjerred/resume' --output-logs=errors-only --summarize",
    "bun --no-install packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts caddyfile.generated",
    // The image lane smoke-tests Caddy against this. It travels as a JSON
    // string because each Woodpecker workflow gets its own workspace.
    "jq -Rs . < caddyfile.generated | bun --no-install scripts/ci/write-ci-handoff.ts caddyfile",
  ];
}

export type PipelineInputs = {
  readonly images: CiImages;
  /**
   * Newest commit on the default branch whose pipeline succeeded, or undefined
   * when the branch has never gone green.
   */
  readonly changedBase: string | undefined;
  /** Last successful verify workflow, even if a later release lane failed. */
  readonly verifyBase?: string | undefined;
  /**
   * Newest commit whose images were built, pushed, AND pinned. Stricter than
   * `changedBase`, and undefined when no recent build qualifies.
   */
  readonly imageReleaseBase?: string | undefined;
};

export function buildPipelineSteps({
  images,
  changedBase,
  verifyBase,
  imageReleaseBase,
}: PipelineInputs): CiStep[] {
  const sharedEnvironment = {
    CI_CHANGED_BASE: changedBase ?? "",
    CI_LAST_IMAGE_RELEASE_COMMIT: imageReleaseBase ?? "",
  };

  return [
    {
      key: "verify",
      label: "verify",
      image: images.base,
      commands: verifyCommands(),
      environment: {
        ...sharedEnvironment,
        CI_CHANGED_BASE: verifyBase ?? changedBase ?? "",
      },
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
        ...HANDOFF_KEYS,
      ],
      volumes: [BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE],
    },
    ...scannerSteps(images),
    ...alertDashboardSteps(images),
    ...resumeSteps(images),
    ...trmnlSteps(images),
    ...tofuPlanSteps(images),
    ...playwrightSteps(images, changedBase),
    releaseAdmissionStep(images),
    ...tofuApplySteps(images),
    ...releaseChainSteps(images, sharedEnvironment),
    ...ciImageSteps(images),
    ...scoutSteps(images),
    ...siteSteps(images),
    ...macosSteps(),
    ...observabilityE2eSteps(images),
    ...prGateSteps(images),
  ];
}
