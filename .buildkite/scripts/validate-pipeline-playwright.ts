// Content-specific invariant checks for the Playwright e2e lanes, split out of
// validate-pipeline.ts to keep the entry file under the max-lines budget. Each
// lane must use the exact filtered install, consume the committed image pin,
// run only the no-install test closure, restore no runtime bootstrap, and carry
// the reporting collector contract that matches each lane's skip semantics.
import {
  fail,
  hasTrimmedLine,
  requireIncludes,
} from "./validate-pipeline-lib.ts";

export function validatePlaywrightLanes(
  stepBlocks: ReadonlyMap<string, string>,
): void {
  for (const key of ["playwright-e2e-pr", "playwright-e2e-main"]) {
    const block = stepBlocks.get(key);
    // The Scout flat config lives in the parent workspace, so isolated installs
    // must select that config owner (scout-for-lol), every shipped Scout web
    // surface, the design-system catalog, and the eval package that invokes it
    // (@scout-for-lol/evals). Alerts contributes its own browser suite and
    // remains in the install closure.
    const install =
      ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter sjer.red --filter '@shepherdjerred/docs-wiki' --filter '@shepherdjerred/alert-dashboard' --filter '@shepherdjerred/birmel' --filter scout-for-lol --filter '@scout-for-lol/app' --filter '@scout-for-lol/frontend' --filter '@scout-for-lol/docs-site' --filter '@scout-for-lol/design-audit' --filter '@scout-for-lol/design-system' --filter '@scout-for-lol/evals' --filter '@shepherdjerred/monorepo' --filter '@shepherdjerred/root-scripts'";
    if (!hasTrimmedLine(block, install)) {
      fail(
        `Playwright lane ${key} is missing exact filtered install ${install}`,
      );
    }
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
      "bun x --no-install turbo run build lint test",
      `Playwright lane ${key} is missing its build/lint/test closure`,
    );
    requireIncludes(
      block,
      "bun x --no-install turbo run test:e2e",
      `Playwright lane ${key} is missing its lower-level browser test closure`,
    );
    requireIncludes(
      block,
      "bun --no-install scripts/namespace-playwright-reports.ts",
      `Playwright lane ${key} does not namespace its Playwright JUnit report before upload`,
    );
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
    const reportingContracts =
      key === "playwright-e2e-main"
        ? [
            "missing-error: 0",
            "if [ ! -s .ci-reports/junit/sjer.red/playwright.xml ]; then",
          ]
        : ["missing-error: 1"];
    for (const required of reportingContracts) {
      requireIncludes(
        block,
        required,
        `Playwright lane ${key} is missing reporting contract ${required}`,
      );
    }
  }
}
