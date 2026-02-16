import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";

export function createDnsAuditApp(chart: Chart) {
  return new Application(chart, "dns-audit-app", {
    metadata: {
      name: "dns-audit",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "dns-audit",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "dns-audit",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
