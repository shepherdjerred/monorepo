/**
 * ArgoCD sync, health check, and resource-deletion wait step generators.
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

/**
 * Explicit fail-closed check that the SeaweedFS S3 TunnelBinding finalizer has
 * completed before the Cloudflare DNS record is deleted. Runs after deploy-argocd
 * and before tofu-apply-cloudflare.
 *
 * ArgoCD's health-wait does not guarantee that finalizers on pruned resources
 * have completed — it only checks the health of remaining resources. This step
 * explicitly polls the ArgoCD resource API until the TunnelBinding returns 404,
 * confirming the Cloudflare tunnel operator's finalizer has removed the ingress
 * route.
 *
 * After this PR is fully deployed and the TunnelBinding no longer exists in the
 * codebase, this step completes immediately (ArgoCD returns 404 on the first poll).
 */
export function waitForTunnelBindingDeletionStep(
  dependsOnKey: string,
): BuildkiteStep {
  return {
    label: `:cloudflare: Wait for SeaweedFS TunnelBinding deletion`,
    key: "wait-tunnel-binding-deletion",
    if: MAIN_ONLY,
    depends_on: dependsOnKey,
    command:
      `${DAGGER_CALL} argo-cd-wait-for-resource-deletion` +
      ` --app-name apps` +
      ` --group networking.cfargotunnel.com` +
      ` --version v1` +
      ` --kind TunnelBinding` +
      ` --namespace cloudflare-tunnel` +
      ` --resource-name seaweedfs-s3-cf-tunnel` +
      ` --argo-cd-token env:ARGOCD_AUTH_TOKEN` +
      ` --timeout-seconds 120` +
      DRYRUN_FLAG,
    timeout_in_minutes: 5,
    priority: 1,
    retry: RETRY,
    env: DAGGER_ENV,
    plugins: [
      k8sPlugin({
        cpu: "100m",
        memory: "128Mi",
        secrets: ["buildkite-argocd-token"],
      }),
    ],
  };
}
