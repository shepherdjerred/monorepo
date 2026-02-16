import { Chart, Size } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { Schedule } from "../../../generated/imports/velero.io.ts";
import versions from "../../versions.ts";
import { Namespace } from "cdk8s-plus-31";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";
import { KubeClusterRole, KubeClusterRoleBinding } from "../../../generated/imports/k8s.ts";
import { VELERO_SCHEDULES } from "../velero-schedules.ts";
export function createVeleroApp(chart: Chart) {
  new Namespace(chart, `velero-namespace`, {
    metadata: {
      name: `velero`,
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
      },
    },
  });

  // Grant Coder default ServiceAccount access to Velero resources
  new KubeClusterRole(chart, "velero-coder-access-role", {
    metadata: {
      name: "velero-coder-access",
    },
    rules: [
      {
        apiGroups: ["velero.io"],
        resources: [
          "backups",
          "restores",
          "schedules",
          "backupstoragelocations",
          "volumesnapshotlocations",
          "downloadrequests",
          "deletebackuprequests",
          "podvolumebackups",
        ],
        verbs: ["get", "list", "watch", "create", "delete", "patch", "update"],
      },
      {
        apiGroups: [""],
        resources: ["pods", "pods/log"],
        verbs: ["get", "list", "watch"],
      },
      {
        apiGroups: ["apps"],
        resources: ["deployments"],
        verbs: ["get", "list", "watch"],
      },
    ],
  });

  new KubeClusterRoleBinding(chart, "velero-coder-access-binding", {
    metadata: {
      name: "velero-coder-access-binding",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "velero-coder-access",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "default",
        namespace: "coder",
      },
    ],
  });

  // 1Password secret for cloud credentials (AWS/GCP/Azure)
  const cloudCredentials = new OnePasswordItem(chart, "velero-cloud-credentials-onepassword", {
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/7thelujgeruxxp2qdsrqe2wd7q",
    },
    metadata: {
      name: "cloud-credentials",
      namespace: "velero",
    },
  });

  // Create all backup schedules from configuration
  for (const scheduleConfig of VELERO_SCHEDULES) {
    new Schedule(chart, scheduleConfig.id, {
      metadata: {
        name: scheduleConfig.name,
        namespace: "velero",
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
    configuration: {
      backupStorageLocation: [
        {
          name: "default",
          bucket: "homelab",
          default: true,
          provider: "aws",
          prefix: "torvalds/backups/",
          config: {
            region: "auto", // Cloudflare R2 uses "auto" region
            s3Url: "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
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
            s3Url: "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com",
            prefix: "torvalds/zfs/",
            multiPartChunkSize: Size.mebibytes(20).asString(),
          },
        },
      ],
    },
    credentials: {
      existingSecret: cloudCredentials.name,
    },
    kubectl: {
      image: {
        repository: "bitnamilegacy/kubectl",
        tag: "1.33.4",
      },
    },
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
        image: `openebs/velero-plugin:${versions["openebs/velero-plugin"]}`,
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
          prune: true,
          selfHeal: true,
        },
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
