import type { CiImages } from "#src/images.ts";
import { HANDOFF_KEYS } from "#src/pipeline/lanes/tofu.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { BROWSER_TIER } from "#src/pipeline/tiers.ts";
import { diagnosticCommands } from "#src/pipeline/diagnostics.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";
import { BUN_CACHE, BUN_CACHE_CONTROL } from "#src/pipeline/cache.ts";
import {
  TURBO_CACHE_TOKEN,
  TURBO_REMOTE_CACHE_ENVIRONMENT,
} from "#src/pipeline/turbo-cache.ts";

const BROWSER_RUNNER =
  "bun --no-install ci/scripts/selection/run-playwright.ts";
const PARTITION_MODULE = "ci/scripts/selection/playwright-partition.ts";
const IS_IMAGE_PROMOTION_PR =
  '[ "$CI_PIPELINE_EVENT" = "pull_request" ] || [ "$CI_PIPELINE_EVENT" = "pull_request_metadata" ]';

export const MEDIA_BROWSER_WORKFLOW = "playwright-media-e2e";

/**
 * Main verifies the Media suite independently so a cold run of it cannot
 * consume the deadline shared by the other browser projects. Sites wait for
 * both workflows; the primary browser workflow provides the tested bundles.
 *
 * Playwright image promotion PRs and owner benchmarks keep the full browser
 * workflow. Other PRs run affected projects locally (`bun run e2e:affected`).
 */
export function playwrightSteps(
  images: CiImages,
  changedBase = "",
  publishArtifacts = true,
): CiStep[] {
  const primary = browserStep(
    "playwright-e2e",
    images,
    changedBase,
    publishArtifacts,
  );
  return publishArtifacts
    ? [primary, browserStep(MEDIA_BROWSER_WORKFLOW, images, changedBase, false)]
    : [primary];
}

function browserStep(
  key: "playwright-e2e" | typeof MEDIA_BROWSER_WORKFLOW,
  images: CiImages,
  changedBase: string,
  publishArtifacts: boolean,
): CiStep {
  const media = key === MEDIA_BROWSER_WORKFLOW;
  const command = media
    ? `${BROWSER_RUNNER} --partition media`
    : publishArtifacts
      ? `if ${IS_IMAGE_PROMOTION_PR} || [ ! -f ${PARTITION_MODULE} ]; then ${BROWSER_RUNNER}; else ${BROWSER_RUNNER} --partition primary; fi`
      : BROWSER_RUNNER;
  // The trusted extension can regenerate a workflow for a historical source
  // revision. The paired primary command still runs the full selection there.
  const historicalSource = `if [ ! -f ${PARTITION_MODULE} ]; then echo 'This source predates browser partitioning. The paired browser workflow runs the full selection.'; exit 0; fi`;
  return {
    key,
    label: media ? "playwright e2e (Media)" : "playwright e2e",
    defaultBranchOnly: true,
    // The ci-playwright promotion PR is exercised here before it
    // auto-merges: it always rewrites ci/ci-playwright/DIGEST and STATE.json
    // (ciImagePromotionFiles in ci/scripts/images/update-ci-image-pin-core.ts)
    // and bumps the @playwright/test pins, and the candidate digest is the
    // image this lane runs. Not keyed on bun.lock or package.json, which
    // would bring the lane back for most pull requests.
    ...(media ? {} : { pullRequestInclude: ["ci/ci-playwright/**"] }),
    image: images.playwright,
    environment: {
      CI_CHANGED_BASE: changedBase,
      // Browser suites already hash this input; supply the actual pinned
      // image so a browser/toolchain change cannot reuse an older result.
      CI_PLAYWRIGHT_IMAGE: images.playwright,
      ...TURBO_REMOTE_CACHE_ENVIRONMENT,
    },
    commands: [
      ...(media ? [historicalSource] : []),
      ...diagnosticCommands(key, [
        // Postgres scope: several suites need a live database.
        "MISE_TOOLCHAIN_SCOPE=postgres . ci/scripts/toolchain.sh",
        // A PR compares against its target branch even before main has a
        // successful Woodpecker pipeline to supply a changed-file base.
        `if ${IS_IMAGE_PROMOTION_PR}; then`,
        '  if git fetch --no-tags --depth=100 origin "$CI_COMMIT_SHA" && git fetch --no-tags --depth=100 origin "$CI_COMMIT_TARGET_BRANCH"; then',
        '    if ! CI_CHANGED_BASE="$(git merge-base HEAD FETCH_HEAD)"; then CI_CHANGED_BASE=""; fi',
        "  else",
        '    CI_CHANGED_BASE=""',
        "  fi",
        "  export CI_CHANGED_BASE",
        "fi",
        'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
        // One Turbo run in a fresh workspace never reads a local cache back.
        'export TURBO_CACHE="remote:rw"',
        // Playwright configs use CI=true to enable JUnit reporters and bounded
        // workers; Woodpecker supplies CI=woodpecker by default.
        "export CI=true",
        command,
        // The suites build these bundles to test them; the deploy lane then
        // ships exactly what was tested instead of rebuilding.
        ...(publishArtifacts
          ? [
              "if [ -d packages/sjer.red/dist ]; then bun --no-install scripts/ci/ci-artifact.ts put sjer-red-dist; fi",
              "if [ -d packages/docs/wiki/dist ]; then bun --no-install scripts/ci/ci-artifact.ts put wiki-dist; fi",
            ]
          : []),
      ]),
    ],
    // This workflow builds its own Turbo prerequisites in its own workspace.
    // Completion and deployment still wait for both verification and E2E.
    timeoutMinutes: 30,
    resources: BROWSER_TIER,
    volumes: [BUN_CACHE, BUN_CACHE_CONTROL],
    secrets: [
      {
        secret: "ci-github-credentials",
        key: "GITHUB_DOWNLOAD_TOKEN",
        env: "GITHUB_DOWNLOAD_TOKEN",
      },
      TURBO_CACHE_TOKEN,
      ...HANDOFF_KEYS,
    ],
    changed: {
      include: [
        ...GLOBAL_SELECTOR_INPUTS,
        "bun.lock",
        "bunfig.toml",
        "package.json",
        "turbo.json",
        "ci/scripts/selection/**",
        "scripts/ci/namespace-playwright-reports.ts",
        "scripts/ci/write-ci-report-index.ts",
        "packages/delivery/**",
        "packages/sjer.red/**",
        "packages/docs/wiki/**",
        "packages/alert-dashboard/**",
        "packages/media/**",
        "packages/tracker/**",
        "packages/scout-for-lol/**",
      ],
    },
  };
}
