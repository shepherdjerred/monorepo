import path from "node:path";
import { playwright } from "@vitest/browser-playwright";

/**
 * The Vitest config for browser-mode tests (`src/**\/*.browser.test.{ts,tsx}`),
 * run in headless Chromium through Playwright. A package opts in with a
 * `vitest.browser.config.ts` that default-exports
 * `browserTestConfig(packageJson.name)` and a `test:browser` script
 * (`vitest --config vitest.browser.config.ts run`); the root
 * `vitest.config.ts` excludes these files from `test`.
 *
 * Playwright finds Chromium through PLAYWRIGHT_BROWSERS_PATH, which the
 * ci-playwright image sets, so CI downloads nothing. When
 * CI_BROWSER_TEST_JUNIT_DIR is set, the run also writes
 * `<dir>/<package>/playwright.xml`, where the Playwright lane collects reports.
 */
export function browserTestConfig(
  packageName: string,
  workspaceRoot: string = process.cwd(),
): Record<string, unknown> {
  // Vitest runs under Bun; Knip only loads this file under Node to read it.
  const reportRoot =
    typeof Bun === "undefined"
      ? undefined
      : Bun.env["CI_BROWSER_TEST_JUNIT_DIR"];
  const reportDirectory = packageName.replaceAll("@", "").replaceAll("/", "__");
  return {
    root: workspaceRoot,
    test: {
      include: ["src/**/*.browser.test.{ts,tsx}"],
      env: { TZ: "UTC" },
      reporters:
        reportRoot === undefined
          ? ["default"]
          : [
              "default",
              [
                "junit",
                {
                  outputFile: path.join(
                    reportRoot,
                    reportDirectory,
                    "playwright.xml",
                  ),
                },
              ],
            ],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
      },
    },
  };
}
