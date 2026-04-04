/**
 * Homelab Helm chart step generators.
 *
 * cdk8sSynthStep runs in the build phase (generates K8s manifests).
 * Helm push steps run in the release phase (package + push charts).
 */
import { HELM_CHARTS } from "../catalog.ts";
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function cdk8sSynthStep(dependsOn: string[]): BuildkiteStep {
  const deps = WORKSPACE_DEPS["homelab/src/cdk8s"] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  return {
    label: ":cdk8s: Build cdk8s Manifests",
    key: "homelab-cdk8s",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: `dagger call homelab-synth --pkg-dir ./packages/homelab/src/cdk8s ${depFlags} --tsconfig ./tsconfig.base.json`,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
  };
}

function helmPushStep(chartName: string): BuildkiteStep {
  return {
    label: `:helm: Push ${chartName}`,
    key: `helm-push-${chartName}`,
    if: MAIN_ONLY,
    depends_on: ["homelab-cdk8s", "release"],
    command: [
      // Skip if release-please didn't set a version (no release needed)
      `RELEASE_VER=$(buildkite-agent meta-data get release-version --default "")`,
      `if [ -z "$RELEASE_VER" ]; then echo "No release version set — skipping helm push for ${chartName}"; exit 0; fi`,
      [
        `dagger call helm-package --source .`,
        `--chart-name ${chartName}`,
        `--version "$RELEASE_VER"`,
        `--chart-museum-username "$CHARTMUSEUM_USERNAME"`,
        `--chart-museum-password env:CHARTMUSEUM_PASSWORD`,
      ].join(" ") + DRYRUN_FLAG,
    ].join(" && "),
    timeout_in_minutes: 10,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
  };
}

export function homelabHelmGroup(): BuildkiteGroup {
  return {
    group: ":helm: Homelab Helm",
    key: "homelab-helm-push",
    steps: HELM_CHARTS.map((chart) => helmPushStep(chart)),
  };
}
