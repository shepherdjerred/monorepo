/**
 * Build summary annotation step — renders a markdown summary of everything
 * that was released/pushed/deployed, with links, on the build page.
 */
import {
  IMAGE_PUSH_TARGETS,
  INFRA_PUSH_TARGETS,
  HELM_CHARTS,
  NPM_PACKAGES,
  DEPLOY_SITES,
  EXTRA_DEPLOY_SITES,
} from "../catalog.ts";
import { RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

const ALL_IMAGE_KEYS = [...IMAGE_PUSH_TARGETS, ...INFRA_PUSH_TARGETS].map(
  (img) => img.versionKey,
);

function buildSummaryScript(): string {
  // Buildkite interpolates $VAR in command strings, stripping shell variables.
  // Use $$ to escape dollar signs so they pass through to bash as literal $.
  const lines: string[] = [
    `set -euo pipefail`,
    `SUMMARY=/tmp/summary.md`,
    `VERSION="2.0.0-$$BUILDKITE_BUILD_NUMBER"`,
    // Start with static header
    `cat > $$SUMMARY << 'HEADER'`,
    `## :rocket: Build Summary`,
    `HEADER`,
    `echo "" >> $$SUMMARY`,
    `echo "**Version:** $$VERSION" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
    // Images section
    `echo "### :docker: Images" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
    `echo "| Image | Digest |" >> $$SUMMARY`,
    `echo "|-------|--------|" >> $$SUMMARY`,
  ];

  for (const key of ALL_IMAGE_KEYS) {
    lines.push(
      `DIGEST=$$(buildkite-agent meta-data get "digest:${key}" --default "")`,
      `if [ -n "$$DIGEST" ]; then echo "| ${key} | \`$$DIGEST\` |" >> $$SUMMARY; else echo "| ${key} | :x: _not pushed_ |" >> $$SUMMARY; fi`,
    );
  }

  // Helm charts — check per-chart metadata to report actual push status
  lines.push(
    `echo "" >> $$SUMMARY`,
    `echo "### :helm: Helm Charts" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
    `HELM_OK=0`,
    `HELM_FAIL=0`,
  );
  for (const chart of HELM_CHARTS) {
    lines.push(
      `HELM_STATUS=$$(buildkite-agent meta-data get "helm-pushed:${chart}" --default "")`,
      `if [ "$$HELM_STATUS" = "1" ]; then HELM_OK=$$((HELM_OK + 1)); else HELM_FAIL=$$((HELM_FAIL + 1)); fi`,
    );
  }
  lines.push(
    `echo "Published $$HELM_OK / ${String(HELM_CHARTS.length)} charts to [ChartMuseum](https://chartmuseum.sjer.red)" >> $$SUMMARY`,
    `if [ "$$HELM_FAIL" -gt 0 ]; then echo "" >> $$SUMMARY; echo ":warning: $$HELM_FAIL chart(s) failed to push" >> $$SUMMARY; fi`,
    `echo "" >> $$SUMMARY`,
    `echo "<details><summary>Chart list</summary>" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
  );
  for (const chart of HELM_CHARTS) {
    lines.push(
      `HELM_STATUS=$$(buildkite-agent meta-data get "helm-pushed:${chart}" --default "")`,
      `if [ "$$HELM_STATUS" = "1" ]; then echo "- :white_check_mark: ${chart}" >> $$SUMMARY; else echo "- :x: ${chart}" >> $$SUMMARY; fi`,
    );
  }
  lines.push(`echo "" >> $$SUMMARY`, `echo "</details>" >> $$SUMMARY`);

  // NPM packages
  lines.push(
    `echo "" >> $$SUMMARY`,
    `echo "### :npm: NPM Packages" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
  );
  for (const pkg of NPM_PACKAGES) {
    lines.push(
      `echo "- [${pkg.name}](https://www.npmjs.com/package/${pkg.name})" >> $$SUMMARY`,
    );
  }

  // Sites
  lines.push(
    `echo "" >> $$SUMMARY`,
    `echo "### :globe_with_meridians: Sites" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
    `echo "| Site | URL |" >> $$SUMMARY`,
    `echo "|------|-----|" >> $$SUMMARY`,
  );
  for (const site of DEPLOY_SITES) {
    lines.push(
      `echo "| ${site.name} | [${site.url}](${site.url}) |" >> $$SUMMARY`,
    );
  }
  for (const site of EXTRA_DEPLOY_SITES) {
    lines.push(
      `echo "| ${site.name} | [${site.url}](${site.url}) |" >> $$SUMMARY`,
    );
  }

  // ArgoCD
  lines.push(
    `echo "" >> $$SUMMARY`,
    `echo "### :argocd: ArgoCD" >> $$SUMMARY`,
    `echo "" >> $$SUMMARY`,
    `echo "[apps](https://argocd.sjer.red/applications/argocd/apps)" >> $$SUMMARY`,
  );

  // Post annotation
  lines.push(
    `echo "" >> $$SUMMARY`,
    `buildkite-agent annotate --style success --context build-summary < $$SUMMARY`,
  );

  return lines.join("\n");
}

export function buildSummaryStep(dependsOn: string[]): BuildkiteStep {
  return {
    label: ":memo: Build Summary",
    key: "build-summary",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    allow_dependency_failure: true,
    command: buildSummaryScript(),
    timeout_in_minutes: 5,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin()],
  };
}
