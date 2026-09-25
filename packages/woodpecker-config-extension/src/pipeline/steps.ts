import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
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
import {
  imagesPrStep,
  releaseChainSteps,
} from "#src/pipeline/lanes/release.ts";
import { ciImageSteps } from "#src/pipeline/lanes/ci-images.ts";
import { macosCrossCompilerSteps } from "#src/pipeline/lanes/macos-cross-compiler.ts";
import { scoutSteps } from "#src/pipeline/lanes/scout.ts";
import { siteSteps } from "#src/pipeline/lanes/sites.ts";
import { macosSteps } from "#src/pipeline/lanes/macos.ts";
import { observabilityE2eSteps } from "#src/pipeline/lanes/observability-e2e.ts";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import { tasknotesWindowsSteps } from "#src/pipeline/lanes/tasknotes-windows.ts";

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
 * PORT STATUS: complete. All 56 Buildkite steps are covered, except two with
 * no successor: `build-summary` existed only to produce the annotation this
 * migration drops, and `macos-native-dispatch` was a watchdog polling
 * Buildkite job state that Woodpecker's own queueing makes redundant. The remaining lanes (images, tofu, playwright,
 * release, sites, macOS native) are not yet ported; until they are, this
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
    ". ci/scripts/toolchain.sh",
    "ci/scripts/bun-install.sh --frozen-lockfile",
    // CI_CHANGED_BASE arrives in the environment, resolved before this step
    // was generated. It is empty when the branch has never gone green, which
    // correctly makes turbo compare against nothing and build everything.
    'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
    // CI is the cross-machine cache producer and consumer; developer shells
    // stay local-only to avoid large transfers over weak links.
    'export TURBO_CACHE="local:rw,remote:rw"',
    "bun --no-install run verify -- --filter='!sjer.red' --filter='!@shepherdjerred/resume' --concurrency=4 --output-logs=errors-only --summarize",
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
  /**
   * Newest commit whose images were built, pushed, AND pinned. Stricter than
   * `changedBase`, and undefined when no recent build qualifies.
   */
  readonly imageReleaseBase?: string | undefined;
};

export function buildPipelineSteps({
  images,
  changedBase,
  imageReleaseBase,
}: PipelineInputs): CiStep[] {
  /**
   * Change detection for every step, not only the ones that remember to ask.
   *
   * `ci-changed.ts`, the Playwright selector and the image selector all read
   * these, and each treats an absent base as "run everything". A step without
   * them would therefore rebuild and republish on every push to main -- the
   * cross-compiler images, every site, every package.
   */
  const sharedEnvironment = {
    CI_CHANGED_BASE: changedBase ?? "",
    CI_LAST_IMAGE_RELEASE_COMMIT: imageReleaseBase ?? "",
  };

  const steps: CiStep[] = [
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
        ...HANDOFF_KEYS,
      ],
      volumes: [BUN_CACHE, UV_CACHE],
    },
    ...scannerSteps(images),
    ...alertDashboardSteps(images),
    ...resumeSteps(images),
    ...trmnlSteps(images),
    ...tofuPlanSteps(images),
    ...playwrightSteps(images),
    releaseAdmissionStep(images),
    ...tofuApplySteps(images),
    imagesPrStep(images),
    ...releaseChainSteps(images),
    ...ciImageSteps(images),
    ...macosCrossCompilerSteps(images),
    ...scoutSteps(images),
    ...siteSteps(images),
    ...macosSteps(),
    ...observabilityE2eSteps(images),
    ...prGateSteps(images),
    ...tasknotesWindowsSteps(images),
  ];
  return steps.map((step) => ({
    ...step,
    environment: { ...sharedEnvironment, ...step.environment },
  }));
}
