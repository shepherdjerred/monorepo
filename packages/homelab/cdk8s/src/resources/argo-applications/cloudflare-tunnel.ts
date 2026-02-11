import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createCloudflareTunnelApp(chart: Chart) {
  return new Application(chart, "cloudflare-tunnel-app", {
    metadata: {
      name: "cloudflare-tunnel",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "cloudflare-tunnel",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "cloudflare-tunnel",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
