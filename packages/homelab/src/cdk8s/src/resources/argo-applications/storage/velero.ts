import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { Schedule } from "@shepherdjerred/homelab/cdk8s/generated/imports/velero.io.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { VELERO_SCHEDULES } from "@shepherdjerred/homelab/cdk8s/src/resources/velero/velero-schedules.ts";
import { backupMonitoringAnnotations } from "@shepherdjerred/ops-model/backup-policy.ts";
import { applicationProject } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/platform/projects.ts";

/**
 * The `backblaze-velero` item (OpenTofu `backblaze` stack): a key scoped to
 * the Velero bucket, with the AWS credentials file Velero mounts as `cloud`.
 */
export const BACKBLAZE_VELERO_ITEM_ID = "i3upt4mhwczcau7ojyxfpw2s6e";

/**
 * Where Velero writes backup metadata and the openebs plugin writes ZFS
 * streams. Every storage and snapshot location must name the same bucket and
 * endpoint: the plugin's expiry sweep refuses to run otherwise. Backups taken
 * before the move to Backblaze stay in the R2 `homelab` bucket.
 */
export const VELERO_OBJECT_STORE = {
  bucket: "sjerred-velero",
  region: "us-west-004",
  s3Url: "https://s3.us-west-004.backblazeb2.com",
} as const;

/** S3 and Backblaze B2 reject a multipart upload's 10,001st part. */
export const MULTIPART_UPLOAD_MAX_PARTS = 10_000;

/**
 * The multipart part size the openebs plugin streams `zfs send` output with.
 * A stream's size is unknown up front, so the part size alone bounds the
 * largest stream that can complete: 128 MiB allows 1.22 TiB, above the 1 TiB
 * SeaweedFS volume, where 20 MiB failed every full stream past 195 GiB. Fewer
 * parts also cut per-object request load. The uploader buffers up to six
 * parts (five in flight plus one filling) in the Velero pod.
 */
export const ZFS_STREAM_PART_SIZE = Size.mebibytes(128);

/** The Velero namespace. */
export function createVeleroNamespaces(chart: Chart): void {
  new Namespace(chart, `velero-namespace`, {
    metadata: {
      name: `velero`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });
}

/**
 * The cloud credentials the root renders beside the Application, which Velero
 * needs before it starts; the `velero-companion` chart renders the same object
 * under transition rendering and deploys before the upstream Application.
 */
export function createVeleroResources(chart: Chart): OnePasswordItem {
  // 1Password secret for cloud credentials (AWS/GCP/Azure)
  const cloudCredentials = new OnePasswordItem(
    chart,
    "velero-cloud-credentials-onepassword",
    {
      spec: {
        itemPath: vaultItemPath(BACKBLAZE_VELERO_ITEM_ID),
      },
      metadata: {
        name: "cloud-credentials",
        namespace: "velero",
      },
    },
  );
  return cloudCredentials;
}

/**
 * The backup Schedules the root renders beside the Application. They are
 * custom resources of Velero's own CRDs, so under transition rendering the
 * `velero-schedules` chart renders the same objects and deploys after the
 * upstream Application.
 */
export function createVeleroSchedules(chart: Chart): void {
  for (const scheduleConfig of VELERO_SCHEDULES) {
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
}

export function createVeleroApp(chart: Chart) {
  createVeleroNamespaces(chart);

  const cloudCredentials = createVeleroResources(chart);
  createVeleroSchedules(chart);

  const veleroValues: HelmValuesForChart<"velero"> = {
    image: { imagePullSecrets: ["dockerhub-pull-velero"] },
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
    // 30d peak ~140m / ~470Mi with 20 MiB parts. A ZFS stream's part pool
    // adds up to 6 × ZFS_STREAM_PART_SIZE above this baseline. torvalds'
    // memory requests are near allocatable, so a request sized for that peak
    // leaves the pod Pending; with no limit, the burst uses free node memory.
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
          bucket: VELERO_OBJECT_STORE.bucket,
          default: true,
          provider: "aws",
          // Deliberately a literal, NOT misc/nodes.ts's PROD_NODE_HOSTNAME:
          // this is a historical object prefix (cluster-global in practice),
          // kept so every bucket Velero has used shares one layout.
          prefix: "torvalds/backups/",
          config: {
            region: VELERO_OBJECT_STORE.region,
            s3Url: VELERO_OBJECT_STORE.s3Url,
            s3ForcePathStyle: "true",
          },
        },
      ],
      volumeSnapshotLocation: [
        {
          name: "zfspv-incr",
          provider: "openebs.io/zfspv-blockstore",
          config: {
            bucket: VELERO_OBJECT_STORE.bucket,
            incrBackupCount: "15", // number of incremental backups we want to have
            fullBackupPrefix: "zfspv-full",
            backupPathPrefix: "zfspv-incr",
            namespace: "openebs",
            provider: "aws",
            region: VELERO_OBJECT_STORE.region,
            s3Url: VELERO_OBJECT_STORE.s3Url,
            s3ForcePathStyle: "true",
            prefix: "torvalds/zfs/",
            multiPartChunkSize: ZFS_STREAM_PART_SIZE.asString(),
          },
        },
        ...VELERO_SCHEDULES.map((schedule) => ({
          name: schedule.snapshotLocation,
          provider: "openebs.io/zfspv-blockstore",
          config: {
            bucket: VELERO_OBJECT_STORE.bucket,
            incrBackupCount: schedule.incrementalCount.toString(),
            fullBackupPrefix: "zfspv-full",
            backupPathPrefix: "zfspv-incr",
            namespace: "openebs",
            provider: "aws",
            region: VELERO_OBJECT_STORE.region,
            s3Url: VELERO_OBJECT_STORE.s3Url,
            s3ForcePathStyle: "true",
            prefix: "torvalds/zfs/",
            multiPartChunkSize: ZFS_STREAM_PART_SIZE.asString(),
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
        image: firstPartyImageRecipe("velero-plugin"),
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
      project: applicationProject("velero"),
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
