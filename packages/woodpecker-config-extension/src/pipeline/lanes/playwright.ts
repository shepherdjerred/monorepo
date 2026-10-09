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

/**
 * Browser end-to-end suites.
 *
 * Buildkite ran this as `playwright-e2e-pr` and `playwright-e2e-main` with the
 * same command; the pair collapses for the same reason the resume lane's did.
 *
 * The step runs a selector of its own (`run-playwright.ts`) that decides which
 * suites to execute from the changed set. That is deliberate and stays: the
 * pipeline-level guard decides whether the LANE runs at all, and the in-step
 * selector decides which of the seven Playwright projects inside it do.
 */
export function playwrightSteps(images: CiImages, changedBase = ""): CiStep[] {
  return [
    {
      key: "playwright-e2e",
      label: "playwright e2e",
      image: images.playwright,
      environment: {
        CI_CHANGED_BASE: changedBase,
        ...TURBO_REMOTE_CACHE_ENVIRONMENT,
      },
      commands: diagnosticCommands("playwright-e2e", [
        // Postgres scope: several suites need a live database.
        "MISE_TOOLCHAIN_SCOPE=postgres . ci/scripts/toolchain.sh",
        // A PR compares against its target branch even before main has a
        // successful Woodpecker pipeline to supply a changed-file base.
        'if [ "$CI_PIPELINE_EVENT" = "pull_request" ]; then',
        '  if git fetch --no-tags --depth=100 origin "$CI_COMMIT_SHA" && git fetch --no-tags --depth=100 origin "$CI_COMMIT_TARGET_BRANCH"; then',
        '    if ! CI_CHANGED_BASE="$(git merge-base HEAD FETCH_HEAD)"; then CI_CHANGED_BASE=""; fi',
        "  else",
        '    CI_CHANGED_BASE=""',
        "  fi",
        "  export CI_CHANGED_BASE",
        "fi",
        'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
        'export TURBO_CACHE="local:rw,remote:rw"',
        // Playwright configs use CI=true to enable JUnit reporters and bounded
        // workers; Woodpecker supplies CI=woodpecker by default.
        "export CI=true",
        "bun --no-install ci/scripts/selection/run-playwright.ts",
        // The suites build these bundles to test them; the deploy lane then
        // ships exactly what was tested instead of rebuilding.
        "if [ -d packages/sjer.red/dist ]; then bun --no-install scripts/ci/ci-artifact.ts put sjer-red-dist; fi",
        "if [ -d packages/docs/wiki/dist ]; then bun --no-install scripts/ci/ci-artifact.ts put wiki-dist; fi",
      ]),
      dependsOn: ["verify"],
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
          "packages/sjer.red/**",
          "packages/docs/wiki/**",
          "packages/alert-dashboard/**",
          "packages/scout-for-lol/**",
        ],
      },
    },
  ];
}
