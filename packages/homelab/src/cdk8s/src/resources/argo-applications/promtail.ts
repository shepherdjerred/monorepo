import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { CI_NODE_TOLERATION } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
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
    // Baseline request (no limits) so log shipping isn't BestEffort.
    // 30d peak ~315m / ~350Mi; request reflects steady state.
    resources: {
      requests: {
        cpu: "100m",
        memory: "256Mi",
      },
    },
    // Promtail is the only Loki log shipper; without this, CI pod logs on the
    // tainted liskov node are never collected (and KubeDaemonSetMisScheduled
    // fires for the pre-taint pod stranded there).
    tolerations: [CI_NODE_TOLERATION],
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
