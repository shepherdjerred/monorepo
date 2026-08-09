import type { Chart } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import {
  KubeLimitRange,
  KubeConfigMap,
  KubePersistentVolumeClaim,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import { NVME_STORAGE_CLASS_LZ4 } from "@shepherdjerred/homelab/cdk8s/src/misc/storage-classes.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import {
  CI_NODE_HOSTNAME,
  CI_NODE_TOLERATION,
} from "@shepherdjerred/homelab/cdk8s/src/misc/nodes.ts";
import { BUILDKITE_MAX_IN_FLIGHT } from "@shepherdjerred/homelab/cdk8s/src/misc/buildkite.ts";
import {
  BUN_CACHE_MOUNT_PATH,
  createLegacyBuildkiteBunCacheJob,
  createBuildkiteBunCache,
} from "./buildkite-bun-cache.ts";
import { createLegacyBuildkiteMaintenanceJobs } from "./buildkite-legacy-maintenance.ts";
import { createBuildkiteMaintenanceWorker } from "./buildkite-maintenance-worker.ts";
import { MAINTENANCE_IMAGE_READY } from "./maintenance-image-readiness.ts";

function createBuildkiteNamespace(chart: Chart): void {
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
}

function createBuildkiteAgentHooks(chart: Chart): void {
  new KubeConfigMap(chart, "buildkite-agent-hooks", {
    metadata: {
      name: "buildkite-agent-hooks",
      namespace: "buildkite",
    },
    data: {
      "agent-shutdown": `#!/bin/sh
set -eu

echo "Retaining Buildkite agent for terminal cAdvisor scrapes (20s)"
sleep 20
`,
    },
  });
}

export function createBuildkiteApp(chart: Chart) {
  createBuildkiteNamespace(chart);
  createBuildkiteBunCache(chart);
  if (!MAINTENANCE_IMAGE_READY) {
    createLegacyBuildkiteBunCacheJob(chart);
    createLegacyBuildkiteMaintenanceJobs(chart);
  }
  createBuildkiteMaintenanceWorker(chart);

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
  // below; this LimitRange remains a fail-safe for new containers introduced by the
  // controller, so sidecars are never BestEffort and the scheduler sees honest totals.
  //
  // 2026-07 CI-freeze hardening: `default` (limits) added alongside the existing
  // `defaultRequest`. Explicit-tier step containers and the controller's known
  // auxiliary containers set their own resources and aren't affected by this.
  // See the original investigation.
  //
  // 2026-08-02: the 768Mi default OOM-killed the tofu-managed bootstrap
  // pipeline-upload pod when its container-0 had no explicit resources and a
  // broken mirror mount made git fetch the full repo pack into the tmpfs
  // workspace (fleet-wide red PRs; see
  // the original investigation).
  // The fix is explicit resources on every known container — do not raise or
  // remove this default; validate-pipeline-release.ts now enforces the
  // bootstrap pod's explicit limits.
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

  // The LLM observability E2E uses native Tempo and MinIO sidecars in its
  // Buildkite pod. Keeping the Tempo configuration in Git makes the Kubernetes
  // topology equivalent to the former Compose fixture without a DinD daemon or
  // a bind mount that a sidecar cannot see.
  new KubeConfigMap(chart, "llm-observability-e2e-tempo", {
    metadata: { name: "llm-observability-e2e-tempo", namespace: "buildkite" },
    data: {
      "tempo.yaml": `stream_over_http_enabled: true
server:
  http_listen_port: 3200
  log_level: info
distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: "0.0.0.0:4318"
        grpc:
          endpoint: "0.0.0.0:4317"
ingester:
  max_block_duration: 5m
  complete_block_timeout: 10s
  trace_idle_period: 1s
compactor:
  compaction:
    block_retention: 1h
storage:
  trace:
    backend: local
    wal:
      path: /var/tempo/wal
    local:
      path: /var/tempo/blocks
overrides:
  defaults:
    metrics_generator:
      processors: []
`,
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
    metadata: {
      // -liskov: same forced-recreation rename as buildkitd-cache-liskov /
      // turbo-cache-liskov. The original buildkite-git-mirrors claim was
      // (re)created during the liskov migration hours before #1663 switched
      // this definition to the lz4 class, and storageClassName is immutable
      // on a bound claim — ArgoCD sync failed on the diff forever (build
      // 6306). A new name binds fresh on the lz4 class; the old claim is
      // pruned by the argocd-sync step's `sync apps --prune`.
      name: "buildkite-git-mirrors-liskov",
      namespace: "buildkite",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      // The mirror is a shared FULL-clone object cache; retain 3x headroom so
      // repository growth and concurrent mirror updates do not exhaust it.
      resources: { requests: { storage: Quantity.fromString("60Gi") } },
    },
  });

  // OpenTofu provider archives are deterministic but expensive to download.
  // The pipeline takes an advisory lock before invoking tofu because its
  // plugin-cache protocol does not support concurrent writers. RWX is needed
  // for that cross-pod lock even though every claimant is constrained to
  // Liskov; no build output or state is stored here.
  new KubePersistentVolumeClaim(chart, "buildkite-tofu-plugin-cache-pvc", {
    metadata: {
      name: "buildkite-tofu-plugin-cache",
      namespace: "buildkite",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString("10Gi") } },
    },
  });

  // uv's artifact cache is safe for concurrent readers and writers, unlike a
  // virtual environment. Persist only downloads/build artifacts and let every
  // job keep its own .venv in the disposable workspace.
  new KubePersistentVolumeClaim(chart, "buildkite-uv-cache-pvc", {
    metadata: {
      name: "buildkite-uv-cache",
      namespace: "buildkite",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString("20Gi") } },
    },
  });

  // Trivy's filesystem scan cache is BoltDB and unsafe for concurrent step
  // pods. Share only its vulnerability database: a trusted scheduled writer
  // refreshes it while untrusted PR scans mount it read-only and use memory for
  // scan results.
  new KubePersistentVolumeClaim(chart, "buildkite-trivy-db-pvc", {
    metadata: {
      name: "buildkite-trivy-db",
      namespace: "buildkite",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    spec: {
      accessModes: ["ReadWriteMany"],
      storageClassName: NVME_STORAGE_CLASS_LZ4,
      resources: { requests: { storage: Quantity.fromString("5Gi") } },
    },
  });

  createBuildkiteAgentHooks(chart);

  new Application(chart, "buildkite-app", {
    metadata: {
      name: "buildkite",
      // Start the agent stack only after the Kueue controller and queue
      // resources have become Healthy in the parent ArgoCD application.
      annotations: {
        "argocd.argoproj.io/sync-wave": "3",
      },
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
              "agent-config": {
                "hooks-path": "/buildkite/hooks",
                hooksVolume: {
                  name: "buildkite-hooks",
                  configMap: {
                    name: "buildkite-agent-hooks",
                    // Kubernetes mode values are decimal in JSON. 493 = 0755,
                    // so the agent can execute the ConfigMap-backed hook.
                    defaultMode: 493,
                  },
                },
              },
              // Cluster-wide cap on concurrently-scheduled CI jobs. Sized
              // during the 2026-07 incident response (see
              // the original investigation
              // and 2026-07-05_torvalds-ci-freeze-investigation.md). Kueue's
              // pods quota mirrors this value; its CPU/memory quotas provide
              // the weighted admission bound.
              "max-in-flight": BUILDKITE_MAX_IN_FLIGHT,
              "empty-job-grace-period": "5m",
              // Git mirrors: see the buildkite-git-mirrors PVC comment above —
              // every step pod does a FULL clone (turbo merge-base), so the
              // mirror turns ~52s cold checkouts into ~10s reference clones.
              "default-checkout-params": {
                gitMirrors: {
                  volume: {
                    // Pod-level volume NAME stays stable — pipeline.yml's
                    // container volumeMounts reference it. Only the claim
                    // behind it moves to the -liskov lz4 PVC.
                    name: "buildkite-git-mirrors",
                    persistentVolumeClaim: {
                      claimName: "buildkite-git-mirrors-liskov",
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
              // cover expected workspace usage (see .buildkite/pipeline.yml).
              // sizeLimit evicts a
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
                // Mount shared Bun data and independent coordination volumes,
                // but let the static pipeline opt current installs into their
                // managed paths. Older pipeline revisions have no Bun cache
                // environment and therefore fall back to per-pod caching.
                // Strategic merge matches the step container by name.
                volumes: [
                  {
                    name: "buildkite-bun-cache",
                    persistentVolumeClaim: { claimName: "buildkite-bun-cache" },
                  },
                  {
                    name: "buildkite-bun-cache-control",
                    persistentVolumeClaim: {
                      claimName: "buildkite-bun-cache-control",
                    },
                  },
                  {
                    name: "buildkite-uv-cache",
                    persistentVolumeClaim: { claimName: "buildkite-uv-cache" },
                  },
                ],
                containers: [
                  {
                    name: "container-0",
                    env: [
                      { name: "UV_CACHE_DIR", value: "/buildkite/uv-cache" },
                    ],
                    volumeMounts: [
                      {
                        name: "buildkite-bun-cache",
                        mountPath: BUN_CACHE_MOUNT_PATH,
                      },
                      {
                        name: "buildkite-bun-cache-control",
                        mountPath: "/buildkite/bun-cache-control",
                      },
                      {
                        name: "buildkite-uv-cache",
                        mountPath: "/buildkite/uv-cache",
                      },
                    ],
                  },
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
