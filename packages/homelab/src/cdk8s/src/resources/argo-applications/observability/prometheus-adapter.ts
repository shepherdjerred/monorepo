import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createPrometheusAdapterApp(chart: Chart) {
  const prometheusAdapterValues: HelmValuesForChart<"prometheus-adapter"> = {
    prometheus: {
      url: "http://prometheus-kube-prometheus-prometheus.prometheus.svc",
      port: 9090,
      path: "",
    },
    replicas: 1,
    resources: {
      requests: { cpu: "20m", memory: "64Mi" },
    },
    rules: {
      // https://github.com/kubernetes-sigs/prometheus-adapter/issues/264
      default: false,
      custom: [],
      external: [],
      resource: {
        cpu: {
          containerQuery: `sum by (<<.GroupBy>>) (
  rate(container_cpu_usage_seconds_total{container!="",<<.LabelMatchers>>}[3m])
)`,
          nodeQuery: `sum by (<<.GroupBy>>) (
  rate(node_cpu_seconds_total{mode!="idle",mode!="iowait",mode!="steal",<<.LabelMatchers>>}[3m])
)`,
          resources: {
            overrides: {
              node: { resource: "node" },
              namespace: { resource: "namespace" },
              pod: { resource: "pod" },
            },
          },
          containerLabel: "container",
        },
        memory: {
          containerQuery: `sum by (<<.GroupBy>>) (
  avg_over_time(container_memory_working_set_bytes{container!="",<<.LabelMatchers>>}[3m])
)`,
          nodeQuery: `sum by (<<.GroupBy>>) (
  avg_over_time(node_memory_MemTotal_bytes{<<.LabelMatchers>>}[3m])
  -
  avg_over_time(node_memory_MemAvailable_bytes{<<.LabelMatchers>>}[3m])
)`,
          resources: {
            overrides: {
              node: { resource: "node" },
              namespace: { resource: "namespace" },
              pod: { resource: "pod" },
            },
          },
          containerLabel: "container",
        },
        window: "3m",
      },
    },
  };

  return helmApplication(chart, {
    name: "prometheus-adapter",
    namespace: "prometheus",
    chart: "prometheus-adapter",
    repoUrl: "https://prometheus-community.github.io/helm-charts",
    targetRevision: versions["prometheus-adapter"],
    valuesObject: prometheusAdapterValues,
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
