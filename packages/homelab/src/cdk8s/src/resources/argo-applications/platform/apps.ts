import type { Chart } from "cdk8s";
import { deliveryRootIgnoreExpressions } from "homelab/src/delivery-ownership.ts";
import { transitionRendering } from "@shepherdjerred/homelab/cdk8s/src/release-configuration.ts";
import { createFirstPartyApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

/** Fields the Cloudflare operator defaults on every TunnelBinding after apply. */
export const TUNNEL_BINDING_IGNORE_DIFFERENCES = {
  group: "networking.cfargotunnel.com",
  kind: "TunnelBinding",
  jqPathExpressions: [
    ".subjects[].kind",
    ".subjects[].spec.http2Origin",
    ".subjects[].spec.noTlsVerify",
    ".subjects[].spec.proxyAddress",
    ".subjects[].spec.proxyPort",
    ".subjects[].spec.proxyType",
    ".tunnelRef.disableDNSUpdates",
  ],
};

export function createAppsApp(chart: Chart) {
  return createFirstPartyApplication(chart, {
    name: "apps",
    namespace: "argocd",
    // Self-selection follows this immutable chart, including full-source pruning.
    targetRevision: "{{ .Chart.Version }}",
    metadata: {
      // The apps chart manages the root Application itself. Exclude that one
      // self-reference while child Application health is aggregated into root.
      annotations: { "argocd.argoproj.io/ignore-healthcheck": "true" },
    },
    ignoreDifferences: [
      {
        group: "argoproj.io",
        kind: "Application",
        jqPathExpressions: deliveryRootIgnoreExpressions(transitionRendering()),
      },
      TUNNEL_BINDING_IGNORE_DIFFERENCES,
    ],
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: [
        "CreateNamespace=true",
        "ServerSideApply=true",
        "RespectIgnoreDifferences=true",
      ],
    },
  });
}
