import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { Namespace } from "cdk8s-plus-31";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createGrafanaApp(chart: Chart) {
  new Namespace(chart, "prometheus-namespcae", {
    metadata: {
      name: "prometheus",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  createIngress(chart, "grafana-ingress", {
    namespace: "prometheus",
    service: "prometheus-grafana",
    port: 80,
    hosts: ["grafana"],
  });

  return new Application(chart, "grafana-app", {
    metadata: {
      name: "grafana",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: applicationProject("grafana"),
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
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
