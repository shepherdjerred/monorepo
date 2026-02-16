import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";

export function createDdnsApp(chart: Chart) {
  new Namespace(chart, `ddns-namespace`, {
    metadata: {
      name: `ddns`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  return new Application(chart, "ddns-app", {
    metadata: {
      name: "ddns",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://chartmuseum.tailnet-1a49.ts.net",
        targetRevision: "~1.0.0-0",
        chart: "ddns",
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "ddns",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
