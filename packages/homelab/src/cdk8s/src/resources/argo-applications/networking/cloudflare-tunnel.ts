import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createCloudflareTunnelApp(chart: Chart) {
  return new Application(chart, "cloudflare-tunnel-app", {
    metadata: {
      name: "cloudflare-tunnel",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("cloudflare-tunnel"),
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~2.0.0-0",
        chart: "cloudflare-tunnel",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "cloudflare-tunnel",
      },
      syncPolicy: {
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
