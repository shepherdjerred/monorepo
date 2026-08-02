import { fail } from "./validate-pipeline-lib.ts";

export function validateReportingPipeline(pipeline: string): void {
  for (const required of [
    "turbo run test:report",
    "key: playwright-reporting",
    ".ci-reports/junit/sjer.red/playwright.xml",
    "complete reporting run did not emit the sjer.red Playwright JUnit report",
    ".ci-reports/junit/shepherdjerred__docs-wiki/playwright.xml",
    "complete reporting run did not emit the docs-wiki Playwright JUnit report",
    "bun --no-install scripts/namespace-playwright-reports.ts",
    "run script-coverage",
    "write-coverage-summary.ts --require-complete",
    'artifact_paths:\n      - ".ci-reports/**/*"',
    "test-collector#v1.11.0",
    "missing-error: 1",
    '"scope=full"',
    "secretRef: { name: buildkite-ci-secrets }",
    "allowPrivilegeEscalation: false",
    'image: "${CI_BASE_IMAGE}"',
    'image: "${CI_PLAYWRIGHT_IMAGE}"',
  ]) {
    if (!pipeline.includes(required)) {
      fail(`reporting pipeline is missing required contract ${required}`);
    }
  }

  for (const forbidden of [
    "release.ts",
    "helm-push",
    "deploy-site",
    "docker build",
    ":latest",
  ]) {
    if (pipeline.includes(forbidden)) {
      fail(`reporting pipeline contains forbidden release work ${forbidden}`);
    }
  }
}
