import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createAppsApp(chart: Chart) {
  return new Application(chart, "apps-app", {
    metadata: {
      name: "apps",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "apps",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "argocd",
      },
      ignoreDifferences: [
        {
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
        },
      ],
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
