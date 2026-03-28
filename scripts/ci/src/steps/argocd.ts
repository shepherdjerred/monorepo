/**
 * ArgoCD sync and health check step generators.
 */
import { RETRY, DAGGER_ENV } from "../lib/buildkite.ts";
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
    command: `dagger call argo-cd-sync --app ${app} --argocd-token env:ARGOCD_TOKEN`,
    timeout_in_minutes: 10,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({ cpu: "500m", memory: "512Mi", secrets: ["buildkite-argocd-token"] }),
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
    command: `dagger call argo-cd-health-wait --app ${app} --argocd-token env:ARGOCD_TOKEN --timeout-secs 300`,
    timeout_in_minutes: 10,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({ cpu: "500m", memory: "512Mi", secrets: ["buildkite-argocd-token"] }),
    ],
  };
}
