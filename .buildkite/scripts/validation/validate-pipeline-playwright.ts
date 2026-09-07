// Content-specific invariant checks for the Playwright e2e lanes, split out of
// validate-pipeline.ts to keep the entry file under the max-lines budget. Each
// lane delegates dependency-aware target selection and exact filtered install
// to one dependency-free runner, consumes the committed image pin, and keeps
// cache hits distinct from fresh JUnit reports.
import { fail } from "./validate-pipeline-parse.ts";
import { requireIncludes } from "./validate-pipeline-lib.ts";

export function validatePlaywrightLanes(
  stepBlocks: ReadonlyMap<string, string>,
): void {
  for (const key of ["playwright-e2e-pr", "playwright-e2e-main"]) {
    const block = stepBlocks.get(key);
    requireIncludes(
      block,
      'image: "${CI_PLAYWRIGHT_IMAGE}"',
      `Playwright lane ${key} does not consume the committed candidate pin`,
    );
    requireIncludes(
      block,
      "imagePullPolicy: IfNotPresent",
      `Playwright lane ${key} does not use the immutable image pull policy`,
    );
    requireIncludes(
      block,
      "depends_on: verify",
      `Playwright lane ${key} must consume verify's cached build closure`,
    );
    requireIncludes(
      block,
      "export CI_CHANGED_BASE=\"$(buildkite-agent meta-data get ci-changed-base --default '')\"",
      `Playwright lane ${key} does not consume the canonical changed-file base`,
    );
    requireIncludes(
      block,
      'export TURBO_CACHE="local:rw,remote:rw"',
      `Playwright lane ${key} does not enable remote task caching`,
    );
    requireIncludes(
      block,
      "bun --no-install .buildkite/scripts/selection/run-playwright.ts",
      `Playwright lane ${key} does not use the target-aware runner`,
    );
    requireIncludes(
      block,
      'CI_PLAYWRIGHT_IMAGE: "${CI_PLAYWRIGHT_IMAGE}"',
      `Playwright lane ${key} does not hash the committed browser image`,
    );
    requireIncludes(
      block,
      '"playwright-selection-report.json"',
      `Playwright lane ${key} does not preserve its selection/cache report`,
    );
    if (
      block?.includes("turbo run build lint test") === true ||
      block?.includes("turbo run test:e2e") === true
    ) {
      fail(`Playwright lane ${key} bypasses the target-aware runner`);
    }
    // The Scout design audit is no longer part of these lanes; it runs nightly
    // in monorepo-test-reporting. The "must boot the deterministic audit
    // server" invariant moved with it — validate-reporting-pipeline.ts now
    // enforces it — rather than being dropped.
    if (block?.includes("SCOUT_DESIGN_AUDIT_MODE") === true) {
      fail(
        `Playwright lane ${key} runs the Scout design audit; it belongs in the nightly monorepo-test-reporting pipeline`,
      );
    }
    for (const forbidden of [
      "playwright install",
      "bun.zip",
      "apt-get",
      "mcr.microsoft.com/playwright",
    ]) {
      if (block?.includes(forbidden) === true) {
        fail(`Playwright lane ${key} restored runtime bootstrap ${forbidden}`);
      }
    }
    requireIncludes(
      block,
      "missing-error: 0",
      `Playwright lane ${key} must allow reportless verified cache hits`,
    );
  }
}
