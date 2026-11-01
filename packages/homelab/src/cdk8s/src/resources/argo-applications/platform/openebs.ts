import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { CI_NODE_TOLERATION } from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { firstPartyImageRepository } from "@shepherdjerred/version-catalog/image-registry";
import { dockerHubPullSecretName } from "@shepherdjerred/homelab/cdk8s/src/dockerhub-pull-secrets.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

export function createOpenEBSNamespace(chart: Chart): void {
  new Namespace(chart, `openebs-namespace`, {
    metadata: {
      name: `openebs`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

export function createOpenEBSApp(chart: Chart) {
  createOpenEBSNamespace(chart);

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
      imagePullSecrets: [{ name: dockerHubPullSecretName("openebs") }],
      zfsPlugin: {
        image: {
          registry: "",
          repository: firstPartyImageRepository("zfs-driver"),
          // Upstream always joins repository:tag. Keep its required tag as a
          // label; only the frozen dependency's digest selects the image.
          tag: '{{ printf "selected@%s" (last (splitList "@" (required `Delivery requires image:zfs-driver` (get (get (.Values.delivery | default dict) "dependencies" | default dict) "zfs-driver")))) }}',
        },
      },
      zfsNode: {
        encrKeysDir: "/var",
        // The CSI node plugin must run on liskov to provision/mount the
        // CI cache volumes on its local ZFS pool.
        tolerations: [CI_NODE_TOLERATION],
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
        // Each controller container's measured p95 working set is 31-53Mi
        // (7d, 2026-10-31).
        resources: {
          requests: {
            cpu: "25m",
            memory: "64Mi",
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
      project: applicationProject("openebs"),
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
        automated: { enabled: true },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
