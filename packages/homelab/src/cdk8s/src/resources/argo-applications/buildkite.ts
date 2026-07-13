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

// Exported so kueue-config.ts's `pods` nominalQuota can be asserted equal to
// this in a test — the two are independent enforcement layers for the same
// cap and must never drift apart. See the long comment on `max-in-flight`
// below for why both exist.
export const BUILDKITE_MAX_IN_FLIGHT = 10;

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

  // Default resource requests/limits for sidecar containers (e.g. Buildkite agent,
  // checkout) that don't set their own resources. This ensures Kueue can account for
  // sidecar CPU/memory when making admission decisions.
  //
  // 2026-07 CI-freeze hardening: `default` (limits) added alongside the existing
  // `defaultRequest`. Explicit-tier step containers (scripts/ci/src/lib/k8s-plugin.ts)
  // now set their own limits and aren't affected by this; this backstops anything
  // that doesn't. Values match the LIGHT tier used elsewhere in CI (catalog.ts).
  // See packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md.
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
          default: {
            cpu: Quantity.fromString("400m"),
            memory: Quantity.fromString("768Mi"),
          },
        },
      ],
    },
  });

  // The `buildkite-git-mirrors` PVC + `default-checkout-params.gitMirrors`
  // Helm value are intentionally retained even after PR2: the bootstrap
  // NOTE: the monorepo's CI pipeline was removed 2026-07, so nothing feeds
  // this agent stack anymore — it (and this mirror PVC) stay only until the
  // Buildkite service itself is torn down (manual follow-up; see
  // packages/docs/plans/2026-07-12_strip-ci-remove-dagger.md). The BK k8s
  // agent stack auto-configures bootstrap-pod checkouts to use these mirrors
  // via the alternates path `/buildkite/git-mirrors/<encoded-url>/objects`.
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
              // Cluster-wide cap on concurrently-scheduled CI jobs. Sized
              // during the 2026-07 incident response (see
              // packages/docs/logs/2026-07-08_torvalds-cluster-health-deep-check.md
              // and 2026-07-05_torvalds-ci-freeze-investigation.md); moot since
              // the CI pipeline was removed 2026-07 — nothing schedules jobs
              // here until the Buildkite service teardown (manual follow-up).
              "max-in-flight": BUILDKITE_MAX_IN_FLIGHT,
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
