import type { CiImages } from "#src/images.ts";
import { HANDOFF_KEYS } from "#src/pipeline/lanes/tofu.ts";
import type { CiStep } from "#src/pipeline/model.ts";
import { BROWSER_TIER } from "#src/pipeline/tiers.ts";
import { GLOBAL_SELECTOR_INPUTS } from "#src/pipeline/inputs.ts";

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
export function playwrightSteps(images: CiImages): CiStep[] {
  return [
    {
      key: "playwright-e2e",
      label: "playwright e2e",
      image: images.playwright,
      commands: [
        // Postgres scope: several suites need a live database.
        "MISE_TOOLCHAIN_SCOPE=postgres . ci/scripts/toolchain.sh",
        'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
        'export TURBO_CACHE="local:rw,remote:rw"',
        "bun --no-install ci/scripts/selection/run-playwright.ts",
        // The suites build these bundles to test them; the deploy lane then
        // ships exactly what was tested instead of rebuilding.
        "if [ -d packages/sjer.red/dist ]; then bun --no-install scripts/ci/ci-artifact.ts put sjer-red-dist packages/sjer.red/dist; fi",
        "if [ -d packages/docs/wiki/dist ]; then bun --no-install scripts/ci/ci-artifact.ts put wiki-dist packages/docs/wiki/dist; fi",
      ],
      dependsOn: ["verify"],
      timeoutMinutes: 30,
      resources: BROWSER_TIER,
      secrets: [
        {
          secret: "ci-github-credentials",
          key: "GITHUB_DOWNLOAD_TOKEN",
          env: "GITHUB_DOWNLOAD_TOKEN",
        },
        ...HANDOFF_KEYS,
      ],
      // Everything any of the in-step selector's suites depend on, mirroring
      // `lanePaths.playwright` in ci/scripts/migration-core.ts: a narrower
      // guard would skip the lane for a change the selector would have
      // tested.
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "ci/scripts/selectors/ci-changed.ts",
          "ci/scripts/migration-core.ts",
          "ci/scripts/selectors/select-image-targets-lockfile.ts",
          "ci/scripts/selectors/select-image-targets-workspaces.ts",
          "ci/scripts/selection/playwright-targets.ts",
          "ci/scripts/selection/run-playwright.ts",
          "ci/scripts/bun-install.sh",
          "ci/scripts/toolchain.sh",
          "ci/ci-playwright/**",
          ".mise.toml",
          "bun.lock",
          "bunfig.toml",
          "package.json",
          "patches/**",
          "turbo.json",
          "packages/sjer.red/**",
          "packages/astro-opengraph-images/**",
          "packages/webring/**",
          "packages/loaded/**",
          "packages/architecture/**",
          "packages/code-review/**",
          "packages/config/**",
          "packages/feature-flags/**",
          "packages/glitter-context/**",
          "packages/llm-models/**",
          "packages/llm-observability/**",
          "packages/llm-runtime/**",
          "packages/ops-clients/**",
          "packages/ops-model/**",
          "packages/release-tools/**",
          "packages/s3-signed-request/**",
          "packages/temporal-observability/**",
          "packages/version-catalog/**",
          "scripts/**",
          "packages/docs/wiki/**",
          "packages/alert-dashboard/**",
          "packages/birmel/**",
          "packages/eslint-config/**",
          "packages/scout-for-lol/**",
          "config/analytics-sites.json",
        ],
      },
    },
  ];
}
