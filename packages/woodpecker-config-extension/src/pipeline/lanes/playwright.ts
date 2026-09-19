import type { CiImages } from "#src/images.ts";
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
        "MISE_TOOLCHAIN_SCOPE=postgres . .buildkite/scripts/toolchain.sh",
        'if [ -n "$CI_CHANGED_BASE" ]; then export TURBO_SCM_BASE="$CI_CHANGED_BASE"; fi',
        'export TURBO_CACHE="local:rw,remote:rw"',
        "bun --no-install .buildkite/scripts/selection/run-playwright.ts",
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
      ],
      changed: {
        include: [
          ...GLOBAL_SELECTOR_INPUTS,
          "bun.lock",
          "bunfig.toml",
          "package.json",
          "turbo.json",
          "packages/sjer.red/**",
          "packages/docs/wiki/**",
          "packages/alert-dashboard/**",
          "packages/scout-for-lol/**",
        ],
      },
    },
  ];
}
