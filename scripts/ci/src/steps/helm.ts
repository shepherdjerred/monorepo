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
import {
  RETRY,
  DAGGER_ENV,
  DRYRUN_FLAG,
  REPO_GIT_REF,
  gitDir,
  gitFile,
  DAGGER_CALL,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";
import { WORKSPACE_DEPS } from "../../../../.dagger/src/deps.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * Bundle: cdk8s synth + 1Password item lint in one pod, running as parallel
 * siblings (both share the same `bunBaseContainer` prefix, so the install
 * layer is content-addressed and re-used). Pure validation, runs on every
 * branch.
 */
export function homelabCdk8sBundleStep(dependsOn: string[]): BuildkiteStep {
  const deps = WORKSPACE_DEPS["homelab/src/cdk8s"] ?? [];
  const depFlags = deps
    .flatMap((d: string) => [
      `--dep-names ${d}`,
      `--dep-dirs ${gitDir(`packages/${d}`)}`,
    ])
    .join(" ");
  return {
    label: ":cdk8s::1password: Synth + 1Password Lint",
    key: "homelab-cdk8s",
    depends_on: dependsOn,
    // Dagger's camelCase→kebab converter splits numbers as word boundaries
    // (e.g. caddyS3Proxy → caddy-s-3-proxy), so homelabCdk8sBundle registers
    // as `homelab-cdk-8-s-bundle` at the CLI layer, not `homelab-cdk8s-bundle`.
    command: `${DAGGER_CALL} homelab-cdk-8-s-bundle --pkg-dir ${gitDir("packages/homelab/src/cdk8s")} ${depFlags} --tsconfig ${gitFile("tsconfig.base.json")}`,
    timeout_in_minutes: 15,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "250m", memory: "512Mi" })],
  };
}

/**
 * One bundled step that synth's cdk8s and pushes every chart in parallel via
 * `helmPushAll`. The shared synth Directory is content-addressed by the
 * engine, so all charts share one synth run. Replaces a per-chart fan-out
 * (28 pods × ~25 s each) with one pod that runs the same engine-side graph.
 *
 * On success, sets a single `helm-pushed-all` BK meta-data flag so
 * `buildSummaryStep` can report the bundle status. If any chart fails the
 * bundle rejects, the BK step goes red, and the BK log contains every
 * chart's section (`--- :white_check_mark: <chart>` / `+++ :x: <chart>`).
 */
export function homelabHelmPushAllStep(): BuildkiteStep {
  const deps = WORKSPACE_DEPS["homelab/src/cdk8s"] ?? [];
  const synthDepFlags = deps
    .flatMap((d: string) => [
      `--synth-dep-names ${d}`,
      `--synth-dep-dirs ${gitDir(`packages/${d}`)}`,
    ])
    .join(" ");
  const chartFlags = HELM_CHARTS.map((c) => `--chart-names ${c}`).join(" ");
  return {
    label: `:helm: Push ${String(HELM_CHARTS.length)} Helm Charts`,
    key: "helm-push-all",
    if: MAIN_ONLY,
    depends_on: ["quality-gate"],
    command:
      [
        `${DAGGER_CALL} helm-push-all`,
        `--source ${REPO_GIT_REF}`,
        `--synth-pkg-dir ${gitDir("packages/homelab/src/cdk8s")}`,
        synthDepFlags,
        `--tsconfig ${gitFile("tsconfig.base.json")}`,
        chartFlags,
        // Semver prerelease: 2.0.0-BUILD. ArgoCD ~2.0.0-0 auto-updates to latest.
        `--version "2.0.0-$BUILDKITE_BUILD_NUMBER"`,
        `--chart-museum-username "$CHARTMUSEUM_USERNAME"`,
        `--chart-museum-password env:CHARTMUSEUM_PASSWORD`,
      ]
        .filter(Boolean)
        .join(" ") +
      DRYRUN_FLAG +
      ` && buildkite-agent meta-data set "helm-pushed-all" "1"`,
    timeout_in_minutes: 20,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [k8sPlugin({ cpu: "500m", memory: "1Gi" })],
  };
}
