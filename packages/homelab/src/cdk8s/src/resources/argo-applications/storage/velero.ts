import type { Chart } from "cdk8s";
import { ApiObject, Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { Schedule } from "@shepherdjerred/homelab/cdk8s/generated/imports/velero.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { VELERO_SCHEDULES } from "@shepherdjerred/homelab/cdk8s/src/resources/velero/velero-schedules.ts";
import { backupMonitoringAnnotations } from "@shepherdjerred/ops-model/backup-policy.ts";
export function createVeleroApp(chart: Chart) {
  new Namespace(chart, "ops-restore-rehearsal-namespace", {
    metadata: { name: "ops-restore-rehearsal" },
  });
  new ApiObject(chart, "ops-restore-rehearsal-isolation", {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: "isolate-restore", namespace: "ops-restore-rehearsal" },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: [],
    },
  });
  new Namespace(chart, `velero-namespace`, {
    metadata: {
      name: `velero`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // 1Password secret for cloud credentials (AWS/GCP/Azure)
  const cloudCredentials = new OnePasswordItem(
    chart,
    "velero-cloud-credentials-onepassword",
    {
      spec: {
        itemPath: vaultItemPath("ypce2djferc6zf7bocxft36n6a"),
      },
      metadata: {
        name: "cloud-credentials",
        namespace: "velero",
      },
    },
  );

  // Create all backup schedules from configuration
  for (const scheduleConfig of VELERO_SCHEDULES) {
    // Preserve historical schedule identities while stopping new broken chains.
    new Schedule(chart, scheduleConfig.id, {
      metadata: {
        name: scheduleConfig.legacyName,
        namespace: "velero",
        annotations: {
          "argocd.argoproj.io/sync-options": "Prune=false",
          ...backupMonitoringAnnotations(scheduleConfig.monitoring),
        },
      },
      spec: {
        paused: true,
        schedule: scheduleConfig.cronSchedule,
        template: {
          snapshotVolumes: true,
          labelSelector: { matchLabels: { "velero.io/backup": "enabled" } },
          storageLocation: "default",
          ttl: scheduleConfig.ttl,
          volumeSnapshotLocations: ["zfspv-incr"],
        },
      },
    });
    new Schedule(chart, `${scheduleConfig.id}-v2`, {
      metadata: {
        name: scheduleConfig.name,
        namespace: "velero",
        // Never let an ArgoCD re-sync prune the backup schedules. Pruning
        // backup-class Velero resources while the controller is mid-teardown is
        // the re-deploy failure mode that produces orphan ZFS snapshots (see
        // decisions/2026-05-05_velero-orphan-snapshot-prevention.md, Option 2).
        annotations: {
          "argocd.argoproj.io/sync-options": "Prune=false",
          ...backupMonitoringAnnotations(scheduleConfig.monitoring),
        },
      },
      spec: {
        schedule: scheduleConfig.cronSchedule,
        template: {
          snapshotVolumes: true,
          labelSelector: {
            matchLabels: {
              "velero.io/backup": "enabled",
            },
          },
          storageLocation: "default",
          volumeSnapshotLocations: [scheduleConfig.snapshotLocation],
          ttl: scheduleConfig.ttl,
          metadata: {
            labels: {
              "backup-type": scheduleConfig.backupType,
            },
          },
        },
      },
    });
  }

  const veleroValues: HelmValuesForChart<"velero"> = {
    // Velero configuration
    metrics: {
      serviceMonitor: {
        enabled: true,
        additionalLabels: {
          release: "prometheus",
        },
      },
    },
    // Baseline request (no limits) so the backup controller isn't BestEffort.
    // 30d peak ~140m / ~470Mi.
    resources: {
      requests: {
        cpu: "100m",
        memory: "512Mi",
      },
    },
    configuration: {
      backupStorageLocation: [
        {
          name: "default",
          bucket: "homelab",
          default: true,
          provider: "aws",
          // Deliberately a literal, NOT misc/nodes.ts's PROD_NODE_HOSTNAME:
          // this is a historical R2 object prefix (cluster-global in
          // practice), and renaming it would orphan existing backups.
          prefix: "torvalds/backups/",
          config: {
            region: "auto", // Cloudflare R2 uses "auto" region
            s3Url:
              "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
            s3ForcePathStyle: "true",
          },
        },
      ],
      volumeSnapshotLocation: [
        {
          name: "zfspv-incr",
          provider: "openebs.io/zfspv-blockstore",
          config: {
            bucket: "homelab",
            incrBackupCount: "15", // number of incremental backups we want to have
            fullBackupPrefix: "zfspv-full",
            backupPathPrefix: "zfspv-incr",
            namespace: "openebs",
            provider: "aws",
            region: "auto",
            s3Url:
              "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
            s3ForcePathStyle: "true",
            prefix: "torvalds/zfs/",
            multiPartChunkSize: Size.mebibytes(20).asString(),
          },
        },
        ...VELERO_SCHEDULES.map((schedule) => ({
          name: schedule.snapshotLocation,
          provider: "openebs.io/zfspv-blockstore",
          config: {
            bucket: "homelab",
            incrBackupCount: schedule.incrementalCount.toString(),
            fullBackupPrefix: "zfspv-full",
            backupPathPrefix: "zfspv-incr",
            namespace: "openebs",
            provider: "aws",
            region: "auto",
            s3Url:
              "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
            s3ForcePathStyle: "true",
            prefix: "torvalds/zfs/",
            multiPartChunkSize: Size.mebibytes(20).asString(),
          },
        })),
      ],
    },
    credentials: {
      existingSecret: cloudCredentials.name,
    },
    kubectl: {
      image: {
        repository: "bitnamilegacy/kubectl",
        tag:
          versions["bitnamilegacy/kubectl"].split("@")[0] ??
          versions["bitnamilegacy/kubectl"],
      },
    },
    podSecurityContext: { fsGroup: 65_532 },
    initContainers: [
      {
        name: "velero-plugin-for-aws",
        image: `velero/velero-plugin-for-aws:${versions["velero/velero-plugin-for-aws"]}`,
        volumeMounts: [
          {
            mountPath: "/target",
            name: "plugins",
          },
        ],
      },
      {
        name: "velero-plugin-openebs",
        image: `ghcr.io/shepherdjerred/velero-plugin:${versions["shepherdjerred/velero-plugin"]}`,
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 65_532,
          runAsGroup: 65_532,
          allowPrivilegeEscalation: false,
          capabilities: { drop: ["ALL"] },
        },
        volumeMounts: [
          {
            mountPath: "/target",
            name: "plugins",
          },
        ],
      },
    ],
  };

  return new Application(chart, "velero-app", {
    metadata: {
      name: "velero",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        // https://vmware-tanzu.github.io/helm-charts/
        repoUrl: "https://vmware-tanzu.github.io/helm-charts",
        chart: "velero",
        targetRevision: versions.velero,
        helm: {
          releaseName: "velero",
          valuesObject: veleroValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "velero",
      },
      syncPolicy: {
        automated: {
          enabled: true,
          prune: true,
          selfHeal: true,
        },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
