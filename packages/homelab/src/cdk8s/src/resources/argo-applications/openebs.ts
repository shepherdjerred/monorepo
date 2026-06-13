import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
export function createOpenEBSApp(chart: Chart) {
  new Namespace(chart, `openebs-namespace`, {
    metadata: {
      name: `openebs`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  const openEBSValues: HelmValuesForChart<"openebs"> = {
    engines: {
      replicated: {
        mayastor: {
          enabled: false,
        },
      },
      local: {
        lvm: {
          enabled: false,
        },
      },
    },
    "zfs-localpv": {
      zfsNode: {
        encrKeysDir: "/var",
        // Baseline request (no limits) so the CSI driver isn't BestEffort —
        // losing it to eviction breaks all volume operations on the node.
        resources: {
          requests: {
            cpu: "50m",
            memory: "128Mi",
          },
        },
      },
      zfsController: {
        resources: {
          requests: {
            cpu: "25m",
            memory: "128Mi",
          },
        },
      },
    },
    loki: {
      enabled: false,
    },
    alloy: {
      enabled: false,
    },
  };

  return new Application(chart, "openebs-app", {
    metadata: {
      name: "openebs",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://openebs.github.io/openebs",
        targetRevision: versions.openebs,
        chart: "openebs",
        helm: {
          valuesObject: openEBSValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "openebs",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
