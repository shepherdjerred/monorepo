import { fail } from "./validate-pipeline-lib.ts";
import { validateExhaustiveGraphCapacity } from "./validate-pipeline-resources.ts";

export function validateReportingPipeline(pipeline: string): void {
  validateExhaustiveGraphCapacity(pipeline, "complete test reporting");

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
    "serviceAccountName: buildkite-job",
    "automountServiceAccountToken: false",
    "name: GITHUB_DOWNLOAD_TOKEN",
    "name: buildkite-github-credentials",
    "name: TURBO_TOKEN",
    "name: buildkite-turbo-cache-credentials",
    "allowPrivilegeEscalation: false",
    'image: "${CI_BASE_IMAGE}"',
    'image: "${CI_PLAYWRIGHT_IMAGE}"',
    // Relocated from validate-pipeline-playwright.ts when the Scout design
    // audit moved off the per-commit browser lanes. This runner owns one
    // deterministic local stack across the memory-bounded Playwright shards;
    // it never points the nightly audit at someone else's deployment.
    "run --cwd packages/scout-for-lol/packages/design-audit test:e2e:ci",
    'requests: { cpu: "2", memory: "12Gi" }',
    'limits: { cpu: "4", memory: "16Gi" }',
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
