import type { CiImages } from "#src/images.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL, UV_CACHE } from "#src/pipeline/cache.ts";
import { TURBO_VERIFY_TIER } from "#src/pipeline/tiers.ts";
import { diagnosticCommands } from "#src/pipeline/diagnostics.ts";
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
import type { PlatformOperation } from "#src/pipeline/lanes/tofu-apply.ts";
import { releaseChainSteps } from "#src/pipeline/lanes/release.ts";
import { ciImageSteps } from "#src/pipeline/lanes/ci-images.ts";
import { scoutSteps } from "#src/pipeline/lanes/scout.ts";
import { siteSteps } from "#src/pipeline/lanes/sites.ts";
import { observabilityE2eSteps } from "#src/pipeline/lanes/observability-e2e.ts";
import { stormE2eSteps } from "#src/pipeline/lanes/storm-e2e.ts";
import { prGateSteps } from "#src/pipeline/lanes/pr-gates.ts";
import {
  TURBO_CACHE_TOKEN,
  TURBO_REMOTE_CACHE_ENVIRONMENT,
} from "#src/pipeline/turbo-cache.ts";

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
function verifyCommands(options: {
  readonly remoteCache: boolean;
  readonly publishHandoff: boolean;
}): string[] {
  const commands = [
    ". ci/scripts/toolchain.sh",
    "ci/scripts/bun-install.sh --frozen-lockfile",
    // Woodpecker's shallow clone omits the default branch history. Fetch it
    // for the initial main predecessor and the PR coverage fallback.
    'git fetch --no-tags --depth=100 origin "$CI_REPO_DEFAULT_BRANCH"',
    'git update-ref "refs/remotes/origin/$CI_REPO_DEFAULT_BRANCH" FETCH_HEAD',
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
    // CI_CHANGED_BASE is empty before the first green main build. Keep the
    // full Turbo build, but compare coverage with a real predecessor instead
    // of the just-fetched origin/main, which may already equal HEAD.
    'if [ -n "$CI_CHANGED_BASE" ]; then',
    '  export TURBO_SCM_BASE="$CI_CHANGED_BASE" TASKNOTES_COVERAGE_BASE="$CI_CHANGED_BASE"',
    'elif [ "$CI_PIPELINE_EVENT" = "pull_request" ]; then',
    '  export TASKNOTES_COVERAGE_BASE="origin/$CI_REPO_DEFAULT_BRANCH"',
    "else",
    '  export TASKNOTES_COVERAGE_BASE="$(git rev-parse --verify HEAD^)"',
    "fi",
    // CI is the cross-machine cache producer and consumer; developer shells
    // stay local-only to avoid large transfers over weak links.
    options.remoteCache
      ? 'export TURBO_CACHE="local:rw,remote:rw"'
      : 'export TURBO_CACHE="local:rw"',
    "bun --no-install run verify -- --filter='!sjer.red' --filter='!@shepherdjerred/resume' --output-logs=errors-only --summarize",
    "bun --no-install packages/homelab/src/cdk8s/scripts/generate-caddyfile.ts caddyfile.generated",
    // The image lane smoke-tests Caddy against this. It travels as a JSON
    // string because each Woodpecker workflow gets its own workspace.
  ];
  if (options.publishHandoff) {
    commands.push(
      "jq -Rs . < caddyfile.generated | bun --no-install scripts/ci/write-ci-handoff.ts caddyfile",
    );
  }
  return options.publishHandoff
    ? diagnosticCommands("verify", commands)
    : commands;
}

export type PipelineInputs = {
  readonly images: CiImages;
  /** Image of the deployed policy service, supplied by trusted bootstrap. */
  readonly trustedGateImage?: string | undefined;
  /**
   * Newest commit on the default branch whose pipeline succeeded, or undefined
   * when the branch has never gone green.
   */
  readonly changedBase: string | undefined;
  /** Last successful verify workflow, even if a later release lane failed. */
  readonly verifyBase?: string | undefined;
  /**
   * Newest commit with successful image publication and pin handoffs. Stricter than
   * `changedBase`, and undefined when no recent build qualifies.
   */
  readonly imageReleaseBase?: string | undefined;
  /** Handoff coordinates belonging to exactly that image-release commit. */
  readonly imageReleasePipeline?: number | undefined;
  /** One operator-requested platform plan or saved-plan apply. */
  readonly platformOperation?: PlatformOperation;
};

export function buildPipelineSteps({
  images,
  trustedGateImage,
  changedBase = "",
  verifyBase,
  imageReleaseBase = "",
  imageReleasePipeline,
  platformOperation,
}: PipelineInputs): CiStep[] {
  const sharedEnvironment = {
    CI_CHANGED_BASE: changedBase,
    CI_LAST_IMAGE_RELEASE_COMMIT: imageReleaseBase,
    CI_LAST_IMAGE_RELEASE_PIPELINE: imageReleasePipeline?.toString() ?? "",
  };

  const steps: CiStep[] = [
    {
      key: "verify",
      label: "verify",
      image: images.base,
      commands: verifyCommands({ remoteCache: true, publishHandoff: true }),
      environment: {
        ...sharedEnvironment,
        ...TURBO_REMOTE_CACHE_ENVIRONMENT,
        CI_CHANGED_BASE: verifyBase ?? changedBase,
      },
      // A first run in a new trust domain must rebuild every cache entry rather
      // than accepting unsigned output from the former shared cache. Keep the
      // exhaustive gate viable when that cold rebuild takes longer than the
      // normal warm-cache path.
      timeoutMinutes: 60,
      resources: TURBO_VERIFY_TIER,
      secrets: [
        {
          secret: "ci-github-credentials",
          key: "GITHUB_DOWNLOAD_TOKEN",
          env: "GITHUB_DOWNLOAD_TOKEN",
        },
        TURBO_CACHE_TOKEN,
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
    ...tofuApplySteps(images, platformOperation),
    ...releaseChainSteps(images, sharedEnvironment),
    ...ciImageSteps(images),
    ...scoutSteps(images),
    ...siteSteps(images),
    // Native lanes are paused until the Mac agent runs in the GUI audit
    // session. The lane definitions stay in macos.ts for restoration.
    ...observabilityE2eSteps(images),
    ...stormE2eSteps(images),
    ...prGateSteps(images, trustedGateImage),
  ];

  // Each workflow has its own container and environment. The in-step
  // ci-changed selectors must receive the same last-green base as the graph
  // selector; otherwise they fail open and publish, deploy, or rebuild on
  // every main push. Verify may override it with its newer successful base.
  return steps.map((step) => ({
    ...step,
    environment: {
      CI_CHANGED_BASE: changedBase,
      ...step.environment,
    },
  }));
}

/**
 * Useful CI for hosted dependency automation before an owner approves the
 * exact head. It deliberately has no secret grants, shared writable volumes,
 * service daemons, artifact handoff, or remote cache.
 */
export function credentiallessHostedAutomationSteps(
  images: CiImages,
): CiStep[] {
  const verify: CiStep = {
    key: "verify",
    label: "verify (credentialless)",
    image: images.base,
    commands: verifyCommands({ remoteCache: false, publishHandoff: false }),
    environment: { CI_CHANGED_BASE: "" },
    // Hosted automation deliberately has no remote cache credentials, so this
    // is always the cold-cache form of the exhaustive verify gate.
    timeoutMinutes: 60,
    resources: TURBO_VERIFY_TIER,
    events: ["pull_request"],
  };
  return [verify, ...scannerSteps(images, { isolated: true })];
}
