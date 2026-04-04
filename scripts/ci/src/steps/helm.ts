/**
 * Homelab Helm chart step generators.
 *
 * cdk8sSynthStep runs in the build phase (generates K8s manifests).
 * Helm push steps run in the release phase (package + push charts).
 * Synth output is passed via Buildkite artifacts (same pattern as cooklang).
 */
import { HELM_CHARTS } from "../catalog.ts";
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

const CDK8S_ARTIFACT_PATH = "tmp/cdk8s-dist";

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
    command: [
      `dagger call homelab-synth --pkg-dir ./packages/homelab/src/cdk8s ${depFlags} --tsconfig ./tsconfig.base.json export --path ${CDK8S_ARTIFACT_PATH}`,
      `buildkite-agent artifact upload "${CDK8S_ARTIFACT_PATH}/**/*"`,
    ].join(" && "),
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
    depends_on: ["homelab-cdk8s"],
    command:
      [
        `mkdir -p ${CDK8S_ARTIFACT_PATH} && buildkite-agent artifact download "${CDK8S_ARTIFACT_PATH}/**/*" .`,
        [
          `dagger call helm-package --source .`,
          `--cdk8s-dist ${CDK8S_ARTIFACT_PATH}`,
          `--chart-name ${chartName}`,
          // Semver prerelease: 2.0.0-BUILD. ArgoCD ~2.0.0-0 auto-updates to latest.
          `--version "2.0.0-$BUILDKITE_BUILD_NUMBER"`,
          `--chart-museum-username "$CHARTMUSEUM_USERNAME"`,
          `--chart-museum-password env:CHARTMUSEUM_PASSWORD`,
        ].join(" "),
      ].join(" && ") + DRYRUN_FLAG,
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
