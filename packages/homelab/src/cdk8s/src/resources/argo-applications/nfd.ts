import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { Namespace } from "cdk8s-plus-31";

export function createNfdApp(chart: Chart) {
  new Namespace(chart, `nfd-namespace`, {
    metadata: {
      name: `node-feature-discovery`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  new Application(chart, "nfd-app", {
    metadata: {
      name: "nfd",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://kubernetes-sigs.github.io/node-feature-discovery/charts",
        chart: "node-feature-discovery",
        targetRevision: versions["node-feature-discovery"],
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "node-feature-discovery",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
