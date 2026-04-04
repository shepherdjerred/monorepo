/**
 * Homelab Helm chart step generators.
 *
 * Each helm push step runs cdk8s synth + helm package in a single Dagger call.
 * Dagger caches the synth output — first chart runs synth, rest get cache hits.
 * No Buildkite artifact transfer needed.
 *
 * See decisions/2026-04-04_unified-versioning-strategy.md
 */
import { HELM_CHARTS } from "../catalog.ts";
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteGroup, BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * cdk8s synth step — still runs standalone for cdk8s manifest validation
 * and for downstream steps like ArgoCD sync that need the manifests.
 * No longer uploads artifacts — helm push uses Dagger caching instead.
 */
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

/**
 * Each helm push does synth + package in one Dagger call via helmSynthAndPackage.
 * Dagger caches the synth Directory — only the first chart incurs synth cost.
 */
function helmPushStep(chartName: string): BuildkiteStep {
  const deps = WORKSPACE_DEPS["homelab/src/cdk8s"] ?? [];
  const synthDepFlags = deps
    .flatMap((d: string) => [
      `--synth-dep-names ${d}`,
      `--synth-dep-dirs ./packages/${d}`,
    ])
    .join(" ");
  return {
    label: `:helm: Push ${chartName}`,
    key: `helm-push-${chartName}`,
    if: MAIN_ONLY,
    depends_on: ["quality-gate"],
    command:
      [
        `dagger call helm-synth-and-package`,
        `--source .`,
        `--synth-pkg-dir ./packages/homelab/src/cdk8s`,
        synthDepFlags,
        `--tsconfig ./tsconfig.base.json`,
        `--chart-name ${chartName}`,
        // Semver prerelease: 2.0.0-BUILD. ArgoCD ~2.0.0-0 auto-updates to latest.
        `--version "2.0.0-$BUILDKITE_BUILD_NUMBER"`,
        `--chart-museum-username "$CHARTMUSEUM_USERNAME"`,
        `--chart-museum-password env:CHARTMUSEUM_PASSWORD`,
      ]
        .filter(Boolean)
        .join(" ") + DRYRUN_FLAG,
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
