// Content-specific invariant checks for the Playwright e2e lanes, split out of
// validate-pipeline.ts to keep the entry file under the max-lines budget. Each
// lane must use the exact filtered install, consume the committed image pin,
// run only the no-install test closure, and restore no runtime bootstrap.
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
    const install =
      ".buildkite/scripts/bun-install.sh --frozen-lockfile --filter sjer.red --filter '@shepherdjerred/docs-wiki' --filter '@shepherdjerred/monorepo' --filter '@shepherdjerred/root-scripts'";
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
      "bun x --no-install turbo run build lint test test:e2e",
      `Playwright lane ${key} is missing its exact test closure`,
    );
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
  }
}
