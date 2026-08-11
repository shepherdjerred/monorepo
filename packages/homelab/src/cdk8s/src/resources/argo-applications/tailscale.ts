import { ApiObject, type Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import type { TailscaleProxyClass } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";

const PROXY_REQUESTS: Record<
  TailscaleProxyClass,
  { cpu: string; memory: string }
> = {
  standard: { cpu: "20m", memory: "64Mi" },
  medium: { cpu: "20m", memory: "128Mi" },
  heavy: { cpu: "50m", memory: "256Mi" },
};

function createProxyClasses(chart: Chart): void {
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

export function createTailscaleApp(chart: Chart) {
  createProxyClasses(chart);

  new OnePasswordItem(chart, "tailscale-operator-oauth-onepassword", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/mboftvs4fyptyqvg3anrfjy6vu",
    },
    metadata: {
      name: "operator-oauth",
      namespace: "tailscale",
    },
  });

  const tailscaleValues: HelmValuesForChart<"tailscale-operator"> = {
    operatorConfig: {
      resources: {
        requests: { cpu: "50m", memory: "128Mi" },
      },
    },
    proxyConfig: { defaultProxyClass: "standard" },
  };

  return new Application(chart, "tailscale-app", {
    metadata: {
      name: "tailscale",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://pkgs.tailscale.com/helmcharts",
        chart: "tailscale-operator",
        targetRevision: versions["tailscale-operator"],
        helm: { valuesObject: tailscaleValues },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "tailscale",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
