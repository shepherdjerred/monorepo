import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import versions from "../../versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
export function createPromtailApp(chart: Chart) {
  new Namespace(chart, "promtail-namespcae", {
    metadata: {
      name: "promtail",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  const promtailValues: HelmValuesForChart<"promtail"> = {
    config: {
      clients: [
        {
          url: "http://loki-gateway.loki/loki/api/v1/push",
        },
      ],
    },
  };

  return new Application(chart, "promtail-app", {
    metadata: {
      name: "promtail",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://github.com/grafana/helm-charts/tree/main/charts/promtail
        repoUrl: "https://grafana.github.io/helm-charts",
        targetRevision: versions.promtail,
        chart: "promtail",
        helm: {
          valuesObject: promtailValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "promtail",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
