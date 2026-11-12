import { ApiObject, type Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import type { TailscaleProxyClass } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

// Memory requests follow each class's measured p95 proxy working set (7d,
// 2026-10-31): standard 25-48Mi (most ~28Mi), medium 25-51Mi, heavy 70-123Mi.
// Bursts above the request use free node memory; proxies have no limit.
const PROXY_REQUESTS: Record<
  TailscaleProxyClass,
  { cpu: string; memory: string }
> = {
  standard: { cpu: "20m", memory: "32Mi" },
  medium: { cpu: "20m", memory: "64Mi" },
  heavy: { cpu: "50m", memory: "128Mi" },
};

export function createTailscaleProxyClasses(chart: Chart): void {
  for (const [name, requests] of Object.entries(PROXY_REQUESTS)) {
    new ApiObject(chart, `tailscale-proxy-class-${name}`, {
      apiVersion: "tailscale.com/v1alpha1",
      kind: "ProxyClass",
      metadata: {
        name,
        annotations: { "argocd.argoproj.io/sync-wave": "2" },
      },
      spec: {
        statefulSet: {
          pod: {
            tailscaleContainer: { resources: { requests } },
            tailscaleInitContainer: {
              resources: { requests: { cpu: "5m", memory: "16Mi" } },
            },
          },
        },
      },
    });
  }
}

/** Objects the root renders beside the Application; the `tailscale-companion` companion chart renders the same objects under transition rendering. */
export function createTailscaleResources(chart: Chart): void {
  onePasswordSecret(
    chart,
    "tailscale-operator-oauth-onepassword",
    "mboftvs4fyptyqvg3anrfjy6vu",
    { name: "operator-oauth", namespace: "tailscale" },
  );
}

export function createTailscaleApp(chart: Chart) {
  createTailscaleProxyClasses(chart);
  createTailscaleResources(chart);

  const tailscaleValues: HelmValuesForChart<"tailscale-operator"> = {
    operatorConfig: {
      resources: {
        requests: { cpu: "50m", memory: "128Mi" },
      },
    },
    proxyConfig: { defaultProxyClass: "standard" },
  };

  return helmApplication(chart, {
    name: "tailscale",
    namespace: "tailscale",
    chart: "tailscale-operator",
    repoUrl: "https://pkgs.tailscale.com/helmcharts",
    targetRevision: versions["tailscale-operator"],
    valuesObject: tailscaleValues,
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
