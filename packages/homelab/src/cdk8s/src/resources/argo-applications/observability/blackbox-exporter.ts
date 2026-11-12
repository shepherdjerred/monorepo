import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { BLACKBOX_MODULES } from "@shepherdjerred/homelab/cdk8s/src/misc/probes/blackbox-modules.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createBlackboxExporterApp(chart: Chart) {
  const values: HelmValuesForChart<"prometheus-blackbox-exporter"> = {
    serviceMonitor: { enabled: true },
    config: {
      modules: BLACKBOX_MODULES,
    },
  };

  return helmApplication(chart, {
    name: "blackbox-exporter",
    namespace: "prometheus",
    chart: "prometheus-blackbox-exporter",
    repoUrl: "https://prometheus-community.github.io/helm-charts",
    targetRevision: versions["prometheus-blackbox-exporter"],
    valuesObject: values,
    helm: {
      releaseName: "prometheus-prometheus-blackbox-exporter",
    },
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
