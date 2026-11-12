import type { Chart } from "cdk8s";
import { tailnetService } from "homelab/src/platform-model.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { createIngress } from "@shepherdjerred/homelab/cdk8s/src/misc/tailscale.ts";
import { Namespace } from "cdk8s-plus-31";
import { argoApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

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
    hosts: [tailnetService("grafana")],
  });

  return argoApplication(chart, {
    name: "grafana",
    namespace: "prometheus",
    source: {
      repoUrl: "https://github.com/dotdc/grafana-dashboards-kubernetes",
      path: ".",
      targetRevision: versions["dotdc/grafana-dashboards-kubernetes"],
    },
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
