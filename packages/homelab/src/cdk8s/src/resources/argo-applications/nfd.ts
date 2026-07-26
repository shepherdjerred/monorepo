import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { CI_NODE_TOLERATION } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

export function createNfdApp(chart: Chart) {
  new Namespace(chart, `nfd-namespace`, {
    metadata: {
      name: `node-feature-discovery`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // The worker is a per-node DaemonSet; it must label the tainted CI node too
  // (its pre-taint pod there raised KubeDaemonSetMisScheduled).
  const nfdValues: HelmValuesForChart<"node-feature-discovery"> = {
    worker: {
      tolerations: [CI_NODE_TOLERATION],
    },
  };

  new Application(chart, "nfd-app", {
    metadata: {
      name: "nfd",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl:
          "https://kubernetes-sigs.github.io/node-feature-discovery/charts",
        chart: "node-feature-discovery",
        targetRevision: versions["node-feature-discovery"],
        helm: {
          valuesObject: nfdValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "node-feature-discovery",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
