import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";

export function createDeliveryControlPlaneApp(chart: Chart) {
  return new Application(chart, "delivery-control-plane-app", {
    metadata: { name: "delivery-control-plane" },
    spec: {
      project: "default",
      revisionHistoryLimit: 5,
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "delivery-control-plane",
        targetRevision: "~2.0.0-0",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "temporal",
      },
      syncPolicy: {
        automated: { enabled: false },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
