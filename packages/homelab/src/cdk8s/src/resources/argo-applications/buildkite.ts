import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  KubeLimitRange,
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { NVME_STORAGE_CLASS } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

export function createBuildkiteApp(chart: Chart) {
  new Namespace(chart, "buildkite-namespace", {
    metadata: {
      name: "buildkite",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
        "kueue.x-k8s.io/managed-namespace": "true",
      },
    },
  });

  new OnePasswordItem(chart, "buildkite-agent-token", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/z6teegxas67bzggqdjco4pssje",
    },
    metadata: {
      name: "buildkite-agent-token",
      namespace: "buildkite",
    },
  });

  new OnePasswordItem(chart, "buildkite-ci-secrets", {
    spec: {
      itemPath:
        "vaults/v64ocnykdqju4ui6j6pua56xw4/items/rzk3lawpk4yspyyu5rxlz44ssi",
    },
    metadata: {
      name: "buildkite-ci-secrets",
      namespace: "buildkite",
    },
  });

  // Default resource requests for sidecar containers (e.g. Buildkite agent, checkout)
  // that don't set their own resources. This ensures Kueue can account for sidecar
  // CPU/memory when making admission decisions.
  // Only defaultRequest is set — no default limits — so containers can burst freely.
  new KubeLimitRange(chart, "buildkite-limit-range", {
    metadata: { name: "buildkite-default-resources", namespace: "buildkite" },
    spec: {
      limits: [
        {
          type: "Container",
          defaultRequest: {
            cpu: Quantity.fromString("50m"),
            memory: Quantity.fromString("64Mi"),
          },
        },
      ],
    },
  });

  // The `buildkite-git-mirrors` PVC + `default-checkout-params.gitMirrors`
  // Helm value are intentionally retained even after PR2: the bootstrap
  // pipeline-upload step in `.buildkite/pipeline.yml` is the only BK pod
  // that still checks out the repo (it runs `bun src/main.ts` against the
  // local tree). The BK k8s agent stack auto-configures the bootstrap
  // pod's checkout to use these mirrors via the alternates path
  // `/buildkite/git-mirrors/<encoded-url>/objects` — without the mount,
  // git fetch fails with "unable to normalize alternate object path".
  // PR3 of the BK-pressure plan will move pipeline generation itself into
  // Dagger, at which point these can be deleted; until then they cost
  // ~1.3 GiB once per build, which is negligible compared to the per-step
  // savings PR1 + PR2 already deliver. See
  // packages/docs/plans/2026-05-31_bk-dagger-git-url-refactor.md.
  new KubePersistentVolumeClaim(chart, "buildkite-git-mirrors-pvc", {
    metadata: { name: "buildkite-git-mirrors", namespace: "buildkite" },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS,
      resources: { requests: { storage: Quantity.fromString("20Gi") } },
    },
  });

  new Application(chart, "buildkite-app", {
    metadata: {
      name: "buildkite",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "ghcr.io/buildkite/helm",
        chart: "agent-stack-k8s",
        targetRevision:
          versions["agent-stack-k8s"].split("@")[0] ??
          versions["agent-stack-k8s"],
        helm: {
          valuesObject: {
            agentStackSecret: "buildkite-agent-token",
            config: {
              queue: "default",
              // Cluster-wide cap on concurrently-scheduled CI jobs. This is the
              // effective load lever: CI step containers set tiny requests and
              // NO limits (scripts/ci/src/lib/k8s-plugin.ts), so the Kueue
              // ClusterQueue (7.5 CPU / 16Gi, see kueue-config.ts) gate barely
              // bites and this count governs real memory/CPU pressure. Lowered
              // 24 -> 16 to cut peak concurrent build memory after CI build
              // storms froze the node (ARC + pods + OS oversubscribed 128Gi RAM;
              // see packages/docs/logs/2026-07-05_torvalds-ci-freeze-investigation.md).
              // At the observed average step request (~234m), 16 jobs sit at
              // ~3.75 of the 7.5-core Kueue quota — comfortably inside it, so no
              // Kueue re-tune is needed. Bounded by node CPU (peaks ~93%); CPU
              // package temp now peaks ~82-84°C under heavy multi-branch load
              // (post-2026-05-26 AIO + NVMe cooling; was ~100°C pre-cooler).
              "max-in-flight": 16,
              "empty-job-grace-period": "5m",
              // gitMirrors is intentionally retained for the bootstrap
              // pipeline-upload step. See the long comment on the PVC
              // declaration above for why removing this and the PVC was
              // deferred to a follow-up PR.
              "default-checkout-params": {
                gitMirrors: {
                  volume: {
                    name: "buildkite-git-mirrors",
                    persistentVolumeClaim: {
                      claimName: "buildkite-git-mirrors",
                    },
                  },
                  lockTimeout: 300,
                },
              },
              "pod-spec-patch": {
                priorityClassName: "batch-low",
                serviceAccountName: "buildkite-agent-stack-k8s-controller",
                automountServiceAccountToken: true,
                containers: [
                  {
                    name: "agent",
                    envFrom: [
                      {
                        secretRef: {
                          name: "buildkite-ci-secrets",
                        },
                      },
                    ],
                  },
                ],
              },
            },
          } satisfies HelmValuesForChart<"agent-stack-k8s">,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "buildkite",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true", "ServerSideApply=true"],
      },
    },
  });
}
