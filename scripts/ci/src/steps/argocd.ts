/**
 * ArgoCD sync and health check step generators.
 */
import { RETRY, DAGGER_ENV, DRYRUN_FLAG } from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

export function argoCdSyncStep(
  dependsOn: string[],
  opts: { key?: string; app?: string } = {},
): BuildkiteStep {
  const app = opts.app ?? "apps";
  return {
    label: `:argocd: Sync ArgoCD (${app})`,
    key: opts.key ?? "deploy-argocd",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: `dagger call argo-cd-sync --app-name ${app} --argo-cd-token env:ARGOCD_AUTH_TOKEN${DRYRUN_FLAG}`,
    timeout_in_minutes: 10,
    concurrency: 1,
    concurrency_group: `monorepo/argocd-sync-${app}`,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}

export function argoCdHealthStep(
  dependsOn: string,
  opts: { key?: string; app?: string } = {},
): BuildkiteStep {
  const app = opts.app ?? "apps";
  return {
    label: `:heart: Wait for ArgoCD Healthy (${app})`,
    key: opts.key ?? "argocd-health",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: `dagger call argo-cd-health-wait --app-name ${app} --argo-cd-token env:ARGOCD_AUTH_TOKEN --timeout-seconds 300${DRYRUN_FLAG}`,
    timeout_in_minutes: 10,
    priority: 1,
    retry: RETRY,
    soft_fail: true,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "250m",
        memory: "512Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}
