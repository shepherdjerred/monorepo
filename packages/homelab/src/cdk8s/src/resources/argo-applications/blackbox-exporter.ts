import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";

export function createBlackboxExporterApp(chart: Chart) {
  const values: HelmValuesForChart<"prometheus-blackbox-exporter"> = {
    serviceMonitor: { enabled: true },
    config: {
      modules: {
        http_2xx: {
          prober: "http",
          timeout: "10s",
          http: {
            valid_http_versions: ["HTTP/1.1", "HTTP/2.0"],
            follow_redirects: true,
            preferred_ip_protocol: "ip4",
          },
        },
      },
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
