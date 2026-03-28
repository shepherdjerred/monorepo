/**
 * Homelab Helm chart step generators.
 */
import { HELM_CHARTS } from "../catalog.ts";
import { RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

function cdk8sSynthStep(dependsOn: string[]): BuildkiteStep {
  const deps = WORKSPACE_DEPS["homelab/src/cdk8s"] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [`--dep-names ${d}`, `--dep-dirs ./packages/${d}`])
    .join(" ");
  return {
    label: ":cdk8s: Build cdk8s Manifests",
    key: "homelab-cdk8s",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: `dagger call homelab-synth --pkg-dir ./packages/homelab/src/cdk8s --pkg homelab/src/cdk8s ${depFlags} --tsconfig ./tsconfig.base.json`,
    timeout_in_minutes: 15,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
  };
}

function helmPushStep(): BuildkiteStep {
  return {
    label: ":helm: Push Helm Charts",
    key: "homelab-helm-push",
    if: MAIN_ONLY,
    depends_on: "homelab-cdk8s",
    command:
      "dagger call helm-package --source . --chart-dir packages/homelab/charts --chart-museum-password env:CHARTMUSEUM_PASSWORD",
    parallelism: HELM_CHARTS.length,
    timeout_in_minutes: 10,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
  };
}

export function homelabHelmGroup(dependsOn: string[]): BuildkiteGroup {
  return {
    group: ":helm: Homelab Helm",
    key: "homelab-helm",
    steps: [cdk8sSynthStep(dependsOn), helmPushStep()],
  };
}
