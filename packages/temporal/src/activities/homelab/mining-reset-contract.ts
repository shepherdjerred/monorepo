import { z } from "zod";

export const MINING_NAMESPACE = "minecraft-tsmc";
export const MINING_SERVER = "minecraft-tsmc";
export const MINING_CLAIM = "datadir-minecraft-tsmc-0";
export const MINING_LOCK_ANNOTATION = "sjer.red/mining-reset-lock";
export const ROUTER_WAKE_ANNOTATION = "mc-router.itzg.me/autoScaleUp";

export const MiningPeriodSchema = z.string().regex(/^\d{4}q[1-4]$/);

const MetadataSchema = z.object({
  name: z.string(),
  resourceVersion: z.string().optional(),
  annotations: z.record(z.string(), z.string()).optional(),
  labels: z.record(z.string(), z.string()).optional(),
});

export const StatefulSetSchema = z.object({
  metadata: MetadataSchema,
  spec: z.object({
    replicas: z.number().int(),
    template: z.object({
      spec: z.object({
        containers: z.array(z.object({ image: z.string() })),
      }),
    }),
  }),
  status: z.object({ replicas: z.number().int().optional() }).optional(),
});

export const ServiceSchema = z.object({ metadata: MetadataSchema });
export const PvcListSchema = z.object({
  items: z.array(
    z.object({
      metadata: MetadataSchema,
      status: z.object({ phase: z.string() }).optional(),
    }),
  ),
});
export const PodListSchema = z.object({
  items: z.array(
    z.object({
      metadata: MetadataSchema.extend({
        ownerReferences: z
          .array(z.object({ kind: z.string(), name: z.string() }))
          .optional(),
      }),
      status: z.object({ phase: z.string() }).optional(),
    }),
  ),
});
export const BackupSchema = z.object({
  metadata: MetadataSchema,
  spec: z.object({
    includedNamespaces: z.array(z.string()),
    labelSelector: z.object({ matchLabels: z.record(z.string(), z.string()) }),
    snapshotVolumes: z.boolean(),
    storageLocation: z.string(),
  }),
  status: z
    .object({
      phase: z.string().optional(),
      errors: z.number().int().optional(),
      warnings: z.number().int().optional(),
      volumeSnapshotsAttempted: z.number().int().optional(),
      volumeSnapshotsCompleted: z.number().int().optional(),
    })
    .optional(),
});
export const JobSchema = z.object({
  metadata: MetadataSchema,
  spec: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(
          z.object({
            name: z.string(),
            image: z.string(),
            command: z.array(z.string()),
            env: z.array(z.object({ name: z.string(), value: z.string() })),
            volumeMounts: z.array(
              z.object({ name: z.string(), mountPath: z.string() }),
            ),
          }),
        ),
        volumes: z.array(
          z.object({
            name: z.string(),
            persistentVolumeClaim: z
              .object({ claimName: z.string() })
              .optional(),
          }),
        ),
      }),
    }),
  }),
  status: z
    .object({
      succeeded: z.number().int().optional(),
      failed: z.number().int().optional(),
    })
    .optional(),
});

export function miningBackupName(period: string): string {
  return `mining-reset-${MiningPeriodSchema.parse(period)}`;
}

export function assertExactlyOneBackedUpClaim(
  claims: z.infer<typeof PvcListSchema>,
): void {
  if (
    claims.items.length !== 1 ||
    claims.items[0]?.metadata.name !== MINING_CLAIM ||
    claims.items[0].status?.phase !== "Bound"
  ) {
    throw new Error(
      `Expected exactly the bound ${MINING_NAMESPACE}/${MINING_CLAIM} PVC in the Velero selector`,
    );
  }
}

export function assertCompletedBackup(
  backup: z.infer<typeof BackupSchema>,
  period: string,
): boolean {
  if (
    backup.metadata.name !== miningBackupName(period) ||
    backup.metadata.labels?.["sjer.red/mining-reset-period"] !== period ||
    backup.spec.includedNamespaces.length !== 1 ||
    backup.spec.includedNamespaces[0] !== MINING_NAMESPACE ||
    backup.spec.labelSelector.matchLabels["velero.io/backup"] !== "enabled" ||
    !backup.spec.snapshotVolumes ||
    backup.spec.storageLocation !== "default"
  ) {
    throw new Error("Mining reset backup does not match the expected scope");
  }
  const status = backup.status;
  if (status?.phase === "Failed" || status?.phase === "PartiallyFailed") {
    throw new Error(`Mining reset backup ended in ${status.phase}`);
  }
  if (status?.phase !== "Completed") {
    return false;
  }
  if (
    hasReportedFailures(status.errors, status.warnings) ||
    status.volumeSnapshotsAttempted !== 1 ||
    status.volumeSnapshotsCompleted !== 1
  ) {
    throw new Error(
      "Mining reset backup lacks one clean completed PVC snapshot",
    );
  }
  return true;
}

function hasReportedFailures(
  errors: number | undefined,
  warnings: number | undefined,
): boolean {
  return (errors ?? 0) !== 0 || (warnings ?? 0) !== 0;
}

function hasExpectedJobContainer(
  job: z.infer<typeof JobSchema>,
  period: string,
  image: string,
): boolean {
  const containers = job.spec.template.spec.containers;
  const container = containers.length === 1 ? containers[0] : undefined;
  return (
    container?.name === "mining-reset" &&
    container.image === image &&
    container.command.length === 4 &&
    container.command[0] === "/bin/sh" &&
    container.command[1] === "-eu" &&
    container.command[2] === "-c" &&
    container.command[3] === miningResetScript("/data") &&
    container.env.length === 1 &&
    container.env[0]?.name === "RESET_PERIOD" &&
    container.env[0].value === period &&
    container.volumeMounts.length === 1 &&
    container.volumeMounts[0]?.mountPath === "/data"
  );
}

export function assertMatchingResetJob(
  job: z.infer<typeof JobSchema>,
  period: string,
  image: string,
): boolean {
  if (
    job.metadata.name !== miningBackupName(period) ||
    job.metadata.labels?.["sjer.red/mining-reset-period"] !== period ||
    !hasExpectedJobContainer(job, period, image) ||
    job.spec.template.spec.volumes.length !== 1 ||
    job.spec.template.spec.volumes[0]?.persistentVolumeClaim?.claimName !==
      MINING_CLAIM
  ) {
    throw new Error(
      "Mining reset Job does not match the expected PVC and image",
    );
  }
  if ((job.status?.failed ?? 0) > 0) {
    throw new Error("Mining reset Job failed; the server remains locked");
  }
  return job.status?.succeeded === 1;
}

export function miningResetScript(root: string): string {
  if (!/^\/[\w/-]+$/.test(root)) {
    throw new Error("Invalid reset mount path");
  }
  return String.raw`set -eu
root='${root}'
period="$RESET_PERIOD"
case "$period" in ????q[1-4]) ;; *) exit 20 ;; esac
[ -d "$root" ] || exit 21
[ ! -L "$root" ] || exit 22
[ ! -L "$root/mining" ] || exit 23
[ ! -L "$root/.mining-reset" ] || exit 24
mkdir -p "$root/.mining-reset"
if [ -f "$root/.mining-reset/$period.done" ]; then
  [ "$(cat "$root/.mining-reset/$period.done")" = "$period" ] || exit 28
  exit 0
fi
tomb="$root/.mining-reset/$period.deleting"
[ ! -L "$tomb" ] || exit 29
if [ ! -d "$tomb" ]; then
  [ ! -e "$tomb" ] || exit 30
  [ -d "$root/mining" ] || exit 25
  [ -f "$root/mining/level.dat" ] || exit 26
  [ -d "$root/mining/region" ] || exit 27
  mv -- "$root/mining" "$tomb"
  sync
fi
rm -rf -- "$tomb"
sync
printf '%s\n' "$period" > "$root/.mining-reset/$period.done.tmp"
mv -- "$root/.mining-reset/$period.done.tmp" "$root/.mining-reset/$period.done"
sync
`;
}
