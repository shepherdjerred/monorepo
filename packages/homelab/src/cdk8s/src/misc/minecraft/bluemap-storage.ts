import {
  getPvcBackupLabels,
  getPvcBackupPolicy,
} from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";
import { zfsNvmeStorageClass } from "@shepherdjerred/homelab/cdk8s/src/misc/storage/zfs-nvme-volume.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export const BLUEMAP_CLAIM = "minecraft-tsmc-bluemap";
const NAMESPACE = "minecraft-tsmc";
const migration = await Bun.file(
  new URL("bluemap-storage/bluemap.py", import.meta.url),
).text();

/** Keep cache storage and its migration script in the server Application's release. */
export function blueMapStorageResources(): object[] {
  return [
    {
      apiVersion: "v1",
      kind: "PersistentVolumeClaim",
      metadata: {
        name: BLUEMAP_CLAIM,
        namespace: NAMESPACE,
        labels: getPvcBackupLabels(
          getPvcBackupPolicy(NAMESPACE, BLUEMAP_CLAIM),
        ),
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: zfsNvmeStorageClass(NAMESPACE, BLUEMAP_CLAIM),
        resources: { requests: { storage: "128Gi" } },
      },
    },
    {
      apiVersion: "v1",
      kind: "ConfigMap",
      metadata: { name: `${BLUEMAP_CLAIM}-migration`, namespace: NAMESPACE },
      data: { "bluemap_storage.py": migration },
    },
  ];
}

export function blueMapStorageVolumes(): object[] {
  return [
    {
      volumes: [
        {
          name: "bluemap",
          persistentVolumeClaim: { claimName: BLUEMAP_CLAIM },
        },
        {
          name: "bluemap-migration",
          configMap: { name: `${BLUEMAP_CLAIM}-migration` },
        },
      ],
      volumeMounts: [{ name: "bluemap", mountPath: "/data/bluemap" }],
    },
  ];
}

/** StatefulSet replacement has stopped the previous Paper process before this copy starts. */
export function blueMapStorageInit(): object {
  return {
    name: "migrate-bluemap",
    // The server's pinned upstream base supplies Python without runtime credentials.
    // Avoid a nested Helm template: the parent apps chart also renders these values.
    image: `itzg/minecraft-server:${versions["itzg/minecraft-server"]}`,
    command: [
      "python3",
      "/migration/bluemap_storage.py",
      "copy",
      "--data",
      "/source",
      "--destination",
      "/cache",
    ],
    securityContext: {
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      capabilities: { drop: ["ALL"] },
    },
    resources: {
      requests: { cpu: "100m", memory: "256Mi" },
      limits: { memory: "1Gi" },
    },
    volumeMounts: [
      { name: "datadir", mountPath: "/source", readOnly: true },
      { name: "bluemap", mountPath: "/cache" },
      { name: "bluemap-migration", mountPath: "/migration", readOnly: true },
    ],
  };
}
