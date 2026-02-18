import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { Namespace } from "cdk8s-plus-31";

export function createGrafanaApp(chart: Chart) {
  new Namespace(chart, "prometheus-namespcae", {
    metadata: {
      name: "prometheus",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  createIngress(
    chart,
    "grafana-ingress",
    "prometheus",
    "prometheus-grafana",
    80,
    ["grafana"],
    false,
  );

  return new Application(chart, "grafana-app", {
    metadata: {
      name: "grafana",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://github.com/dotdc/grafana-dashboards-kubernetes",
        path: ".",
        targetRevision: versions["dotdc/grafana-dashboards-kubernetes"],
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "prometheus",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
