/**
 * ArgoCD sync and health check step generators.
 */
import {
  RETRY,
  DAGGER_ENV,
  DRYRUN_FLAG,
  DAGGER_CALL,
} from "../lib/buildkite.ts";
import { k8sPlugin } from "../lib/k8s-plugin.ts";
import type { BuildkiteStep } from "../lib/types.ts";

const MAIN_ONLY = "build.branch == pipeline.default_branch";

/**
 * One BK pod runs ArgoCD sync + health-wait sequentially via
 * `argo-cd-sync-and-wait`. Sync failure turns the step red; health-wait
 * failure is caught inside the Dagger function (matches the wave-1
 * standalone `argocd-health` step's `soft_fail: true`). Concurrency group
 * stays at the BK layer so the same app can't be synced from two branches
 * at the same time.
 */
export function argoCdSyncAndWaitStep(
  dependsOn: string[],
  opts: { key?: string; app?: string } = {},
): BuildkiteStep {
  const app = opts.app ?? "apps";
  return {
    label: `:argocd::heart: Sync + Wait Healthy (${app})`,
    key: opts.key ?? "deploy-argocd",
    if: MAIN_ONLY,
    depends_on: dependsOn,
    command: `${DAGGER_CALL} argo-cd-sync-and-wait --app-name ${app} --argo-cd-token env:ARGOCD_AUTH_TOKEN --timeout-seconds 300${DRYRUN_FLAG}`,
    timeout_in_minutes: 15,
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
