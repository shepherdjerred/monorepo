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
import {
  CI_NODE_HOSTNAME,
  CI_NODE_TOLERATION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";

// Exported so kueue-config.ts's `pods` nominalQuota can be asserted equal to
// this in a test — the two are independent enforcement layers for the same
// cap and must never drift apart. See the long comment on `max-in-flight`
// below for why both exist.
export const BUILDKITE_MAX_IN_FLIGHT = 20;

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

  // Default resource requests/limits for any generated sidecar that doesn't set its
  // own resources. The known agent and checkout containers are patched explicitly
  // below so Kueue accounts for their different workloads; this LimitRange remains a
  // fail-safe for new containers introduced by the controller.
  //
  // 2026-07 CI-freeze hardening: `default` (limits) added alongside the existing
  // `defaultRequest`. Explicit-tier step containers and the controller's known
  // auxiliary containers set their own resources and aren't affected by this.
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

  // Shared git-mirror store for step-pod checkouts (restored 2026-07-18; it
  // was dropped in the CI replatform on the assumption of "plain shallow
  // checkouts", but the static pipeline does FULL `--no-tags` clones so turbo
  // --affected can reach the merge-base). Measured: a cold full clone of the
  // 964 MB .git is ~52s per pod on every main build vs 8-10s with a warm
  // mirror; ~11-15 pods pay it per build. The agent stack auto-configures
  // checkouts to use the mirror via the alternates path
  // `/buildkite/git-mirrors/<encoded-url>/objects`.
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
              // and 2026-07-05_torvalds-ci-freeze-investigation.md). Kept as the
              // admission bound for the replatformed CI, which schedules jobs on
              // this "default" queue. Mirrored by kueue-config.ts's `pods`
              // nominalQuota — the two must stay in lockstep (asserted in a test).
              "max-in-flight": BUILDKITE_MAX_IN_FLIGHT,
              "empty-job-grace-period": "5m",
              // Git mirrors: see the buildkite-git-mirrors PVC comment above —
              // every step pod does a FULL clone (turbo merge-base), so the
              // mirror turns ~52s cold checkouts into ~10s reference clones.
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
              // Memory-backed build workspace for EVERY job pod: the checkout
              // working tree, per-pod bun installs, and turbo scratch are
              // written once and discarded, so backing the controller's
              // default disk emptyDir with tmpfs keeps those writes (the
              // largest per-pod NVMe write class after the image graph —
              // 20-58 GiB/heavy pod measured pre-#1602) off the xfs /var
              // entirely. tmpfs pages count against each container's memory
              // limit; the pipeline pod anchors' memory REQUESTS are sized to
              // cover expected workspace usage so Kueue admission stays
              // honest (see .buildkite/pipeline.yml). sizeLimit evicts a
              // runaway build (kubelet, fail-fast + step retry) instead of
              // letting it eat the node's RAM.
              "workspace-volume": {
                name: "workspace",
                emptyDir: { medium: "Memory", sizeLimit: "16Gi" },
              },
              // SECURITY: no envFrom on the agent container. It previously
              // injected buildkite-ci-secrets into EVERY pod's agent
              // container — including the pipeline-upload pod, where
              // `buildkite-agent pipeline upload` interpolates `$VAR`
              // references at upload time and bakes the secret VALUES into
              // the stored (UI/API-visible) pipeline. Steps that need
              // secrets get them via their own container-0 envFrom in
              // .buildkite/pipeline.yml, and secret refs there must be
              // written `$$VAR` (runtime shell expansion).
              "pod-spec-patch": {
                priorityClassName: "batch-low",
                // CI step pods run ONLY on the dedicated CI node (liskov):
                // the toleration lets them onto its ci=only:NoSchedule taint,
                // and the nodeSelector keeps them off torvalds. If liskov is
                // down, CI pods stay Pending — deliberate: CI never falls
                // back onto the prod node. Rollback = remove these two keys.
                nodeSelector: { "kubernetes.io/hostname": CI_NODE_HOSTNAME },
                tolerations: [CI_NODE_TOLERATION],
                serviceAccountName: "buildkite-agent-stack-k8s-controller",
                automountServiceAccountToken: true,
                containers: [
                  {
                    name: "agent",
                    resources: {
                      requests: { cpu: "50m", memory: "64Mi" },
                      limits: { cpu: "400m", memory: "768Mi" },
                    },
                    env: [
                      {
                        // kubernetes-bootstrap imposes the AGENT's shell
                        // config on every command container via the
                        // registration env; the agent image has no bash, so
                        // its default is /bin/sh — dash on the debian
                        // ci-base, which broke `set -o pipefail` in
                        // toolchain.sh (builds 5651/5654). Non-secret env
                        // only here — see the security note above.
                        name: "BUILDKITE_SHELL",
                        value: "/bin/bash -e -c",
                      },
                      {
                        // Widen the agent's log redaction beyond the defaults
                        // (*_PASSWORD,*_SECRET,*_TOKEN,*_ACCESS_KEY,
                        // *_SECRET_KEY,*_CONNECTION_STRING) to cover this repo's
                        // secret env-var naming. The agent scrubs the VALUES of
                        // matching vars from log output. Backstop only: it can
                        // redact values the agent process actually sees, and
                        // runtime-minted tokens aren't env vars — those are
                        // handled explicitly via `buildkite-agent redactor add`
                        // in scripts/lib/github-auth.ts.
                        name: "BUILDKITE_REDACTED_VARS",
                        value: [
                          "*_PASSWORD",
                          "*_SECRET",
                          "*_TOKEN",
                          "*_ACCESS_KEY",
                          "*_SECRET_KEY",
                          "*_ACCESS_KEY_ID",
                          "*_PRIVATE_KEY",
                          "*_AUTH_TOKEN",
                          "*_CONNECTION_STRING",
                          "*_CREDENTIALS",
                          // GH_TOKEN / GITHUB_APP_* / TURBO_TOKEN / NPM_TOKEN /
                          // SEAWEEDFS_* / ARGOCD_AUTH_TOKEN are all already
                          // covered by the suffix globs above.
                        ].join(","),
                      },
                    ],
                  },
                  {
                    // The checkout writes the tracked working tree into the
                    // memory-backed workspace. Build #6179 proved that the former
                    // 768Mi LimitRange default was below the clone's real peak:
                    // four concurrent checkout containers were OOMKilled while
                    // materializing the ~573Mi tracked tree. Request the 1Gi
                    // already budgeted in every pipeline pod tier on the container
                    // that owns those tmpfs pages, with 2Gi of bounded burst room.
                    name: "checkout",
                    resources: {
                      requests: { cpu: "50m", memory: "1Gi" },
                      limits: { cpu: "400m", memory: "2Gi" },
                    },
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
