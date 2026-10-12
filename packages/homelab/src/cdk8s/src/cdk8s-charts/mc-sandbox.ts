import type { App } from "cdk8s";
import { Chart } from "cdk8s";
import { MC_SANDBOX_NAMESPACE } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/constants.ts";
import { createMcSandboxLimits } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/limits.ts";
import { createMcSandboxNamespace } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/namespace.ts";
import { createMcSandboxPodGuard } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/pod-guard.ts";
import { createMcHarnessRbac } from "@shepherdjerred/homelab/cdk8s/src/resources/mc-sandbox/rbac.ts";

/**
 * Where the mc-harness agent tooling (packages/mc-harness) runs disposable
 * Paper servers in the cluster, plus the scoped identity it uses for those
 * sandboxes and for reading and backing up the live server. The pods
 * themselves are created at runtime by the harness, never declared here; the
 * harness daemon reaps them by TTL (no CronJob).
 */
export function createMcSandboxChart(app: App) {
  const chart = new Chart(app, "mc-sandbox", {
    namespace: MC_SANDBOX_NAMESPACE,
    disableResourceNameHashes: true,
  });
  createMcSandboxNamespace(chart);
  createMcSandboxLimits(chart);
  createMcSandboxPodGuard(chart);
  createMcHarnessRbac(chart);
  return chart;
}
