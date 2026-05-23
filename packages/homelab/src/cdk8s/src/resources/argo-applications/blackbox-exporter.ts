import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { BLACKBOX_MODULES } from "@shepherdjerred/homelab/cdk8s/src/misc/blackbox-modules.ts";

export function createBlackboxExporterApp(chart: Chart) {
  const values: HelmValuesForChart<"prometheus-blackbox-exporter"> = {
    serviceMonitor: { enabled: true },
    config: {
      modules: BLACKBOX_MODULES,
    },
  };

  return new Application(chart, "blackbox-exporter-app", {
    metadata: { name: "blackbox-exporter" },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://prometheus-community.github.io/helm-charts",
        chart: "prometheus-blackbox-exporter",
        targetRevision: versions["prometheus-blackbox-exporter"],
        helm: {
          releaseName: "prometheus-prometheus-blackbox-exporter",
          valuesObject: values,
        },
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
