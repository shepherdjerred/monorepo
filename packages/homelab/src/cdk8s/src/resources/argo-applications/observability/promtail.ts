import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { CI_NODE_TOLERATION } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createPromtailNamespace(chart: Chart): void {
  new Namespace(chart, "promtail-namespcae", {
    metadata: {
      name: "promtail",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

export function createPromtailApp(chart: Chart) {
  createPromtailNamespace(chart);

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

  return helmApplication(chart, {
    name: "promtail",
    namespace: "promtail",
    chart: "promtail",
    // https://github.com/grafana/helm-charts/tree/main/charts/promtail
    repoUrl: "https://grafana.github.io/helm-charts",
    targetRevision: versions.promtail,
    valuesObject: promtailValues,
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
