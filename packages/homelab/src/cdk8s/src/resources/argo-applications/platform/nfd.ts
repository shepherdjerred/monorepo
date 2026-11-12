import type { Chart } from "cdk8s";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { CI_NODE_TOLERATION } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { helmApplication } from "@shepherdjerred/homelab/cdk8s/src/misc/argo/application.ts";

export function createNfdNamespace(chart: Chart): void {
  new Namespace(chart, `nfd-namespace`, {
    metadata: {
      name: `node-feature-discovery`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

export function createNfdApp(chart: Chart) {
  createNfdNamespace(chart);

  // The worker is a per-node DaemonSet; it must label the tainted CI node too
  // (its pre-taint pod there raised KubeDaemonSetMisScheduled).
  const nfdValues: HelmValuesForChart<"node-feature-discovery"> = {
    worker: {
      tolerations: [CI_NODE_TOLERATION],
    },
  };

  helmApplication(chart, {
    name: "nfd",
    namespace: "node-feature-discovery",
    chart: "node-feature-discovery",
    repoUrl: "https://kubernetes-sigs.github.io/node-feature-discovery/charts",
    targetRevision: versions["node-feature-discovery"],
    valuesObject: nfdValues,
    syncPolicy: {
      automated: { enabled: true },
      syncOptions: ["CreateNamespace=true"],
    },
  });
}
