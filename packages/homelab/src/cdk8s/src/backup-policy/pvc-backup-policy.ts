import { z } from "zod";
import rawPvcBackupPolicy from "./pvc-backup-policy.json" with { type: "json" };

const PvcBackupPolicyEntrySchema = z
  .object({
    namespace: z.string().min(1),
    name: z.string().min(1),
    backup: z.enum(["enabled", "disabled"]),
    reason: z.string().min(1),
  })
  .strict();

const PvcBackupPolicySchema = z.array(PvcBackupPolicyEntrySchema).min(1);

export type PvcBackupPolicyEntry = z.infer<typeof PvcBackupPolicyEntrySchema>;
export type PvcBackupLabels = {
  "velero.io/backup": "enabled" | "disabled";
  "velero.io/exclude-from-backup": "false" | "true";
};

export const PVC_BACKUP_POLICY =
  PvcBackupPolicySchema.parse(rawPvcBackupPolicy);

export function pvcBackupPolicyKey(namespace: string, name: string): string {
  return `${namespace}/${name}`;
}

const PVC_BACKUP_POLICY_BY_KEY = new Map(
  PVC_BACKUP_POLICY.map(
    (entry) =>
      [pvcBackupPolicyKey(entry.namespace, entry.name), entry] as const,
  ),
);

if (PVC_BACKUP_POLICY_BY_KEY.size !== PVC_BACKUP_POLICY.length) {
  throw new Error(
    "PVC backup policy contains duplicate namespace/name entries",
  );
}

export function getPvcBackupPolicy(
  namespace: string,
  name: string,
): PvcBackupPolicyEntry {
  const entry = PVC_BACKUP_POLICY_BY_KEY.get(
    pvcBackupPolicyKey(namespace, name),
  );
  if (entry === undefined) {
    throw new Error(
      `PVC ${pvcBackupPolicyKey(namespace, name)} is missing from the explicit backup policy`,
    );
  }
  return entry;
}

export function getPvcBackupLabels(
  entry: PvcBackupPolicyEntry,
): PvcBackupLabels {
  const enabled = entry.backup === "enabled";
  return {
    "velero.io/backup": enabled ? "enabled" : "disabled",
    "velero.io/exclude-from-backup": enabled ? "false" : "true",
  };
}
