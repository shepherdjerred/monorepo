/**
 * Velero backups of live minecraft-tsmc. The manifest copies the shape the
 * Temporal mining reset uses (packages/temporal/src/activities/homelab/
 * mining-reset.ts `backupManifest`), labelled for the harness; completion is
 * judged like `assertCompletedBackup` in mining-reset-contract.ts. Tier-2
 * writes accept any clean completed backup that covers the namespace,
 * including the cluster's scheduled all-namespace backups.
 */
import { z } from "zod";
import type { Kubectl } from "#providers/kubernetes/kubectl.ts";
import { LIVE_NAMESPACE, VELERO_NAMESPACE } from "./status.ts";

const HARNESS_BACKUP_LABEL = "sjer.red/mc-harness";

export const BackupSchema = z.object({
  metadata: z.object({
    name: z.string(),
    labels: z.record(z.string(), z.string()).optional(),
    creationTimestamp: z.string().optional(),
  }),
  spec: z.object({
    includedNamespaces: z.array(z.string()).optional(),
    snapshotVolumes: z.boolean().optional(),
  }),
  status: z
    .object({
      phase: z.string().optional(),
      errors: z.number().int().nullable().optional(),
      volumeSnapshotsAttempted: z.number().int().nullable().optional(),
      volumeSnapshotsCompleted: z.number().int().nullable().optional(),
      completionTimestamp: z.string().nullable().optional(),
    })
    .optional(),
});
export type Backup = z.infer<typeof BackupSchema>;
export const BackupListSchema = z.object({ items: z.array(BackupSchema) });

/** `mc-harness-20261004t181530z`: unique per second, DNS-label safe. */
export function harnessBackupName(now: Date): string {
  const stamp = now
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d+Z$/u, "z")
    .toLowerCase();
  return `mc-harness-${stamp}`;
}

/** Same scope as the mining-reset backup: the tsmc PVC, snapshotted. */
export function harnessBackupManifest(name: string): string {
  return JSON.stringify({
    apiVersion: "velero.io/v1",
    kind: "Backup",
    metadata: {
      name,
      namespace: VELERO_NAMESPACE,
      labels: { [HARNESS_BACKUP_LABEL]: "true" },
    },
    spec: {
      includedNamespaces: [LIVE_NAMESPACE],
      labelSelector: { matchLabels: { "velero.io/backup": "enabled" } },
      snapshotVolumes: true,
      storageLocation: "default",
      ttl: "720h",
    },
  });
}

export type BackupState =
  | { state: "completed"; completedAt: Date }
  | { state: "pending" }
  | { state: "failed"; reason: string };

/** Completed means: phase Completed, no errors, every volume snapshot done. */
export function backupState(backup: Backup): BackupState {
  const status = backup.status;
  const phase = status?.phase;
  if (
    phase === "Failed" ||
    phase === "PartiallyFailed" ||
    phase === "FailedValidation"
  ) {
    return { state: "failed", reason: `phase ${phase}` };
  }
  if (phase !== "Completed") {
    return { state: "pending" };
  }
  const attempted = status?.volumeSnapshotsAttempted ?? 0;
  const completed = status?.volumeSnapshotsCompleted ?? 0;
  if ((status?.errors ?? 0) !== 0) {
    return { state: "failed", reason: `${String(status?.errors)} error(s)` };
  }
  if (completed !== attempted || attempted < 1) {
    return {
      state: "failed",
      reason: `${completed.toString()}/${attempted.toString()} volume snapshots completed`,
    };
  }
  const at = status?.completionTimestamp;
  return at === undefined || at === null
    ? { state: "pending" }
    : { state: "completed", completedAt: new Date(at) };
}

function coversLive(backup: Backup): boolean {
  const namespaces = backup.spec.includedNamespaces ?? [];
  return (
    backup.spec.snapshotVolumes !== false &&
    (namespaces.includes("*") || namespaces.includes(LIVE_NAMESPACE))
  );
}

/** The newest clean completed backup that covers minecraft-tsmc. */
export function latestUsableBackup(
  list: z.infer<typeof BackupListSchema>,
): { name: string; completedAt: Date } | null {
  let best: { name: string; completedAt: Date } | null = null;
  for (const backup of list.items) {
    if (!coversLive(backup)) {
      continue;
    }
    const state = backupState(backup);
    if (
      state.state === "completed" &&
      (best === null || state.completedAt > best.completedAt)
    ) {
      best = { name: backup.metadata.name, completedAt: state.completedAt };
    }
  }
  return best;
}

export class LiveBackups {
  constructor(
    private readonly kubectl: Kubectl,
    private readonly sleep: (ms: number) => Promise<void> = Bun.sleep,
  ) {}

  async latest(): Promise<{ name: string; completedAt: Date } | null> {
    const { stdout } = await this.kubectl.run([
      "get",
      "backups.velero.io",
      "-o",
      "json",
    ]);
    return latestUsableBackup(BackupListSchema.parse(JSON.parse(stdout)));
  }

  async create(now: Date): Promise<string> {
    const name = harnessBackupName(now);
    await this.kubectl.run(["create", "-f", "-"], harnessBackupManifest(name));
    return name;
  }

  async get(name: string): Promise<Backup> {
    const { stdout } = await this.kubectl.run([
      "get",
      "backups.velero.io",
      name,
      "-o",
      "json",
    ]);
    return BackupSchema.parse(JSON.parse(stdout));
  }

  /** Polls until the backup completes (or fails); throws on failure or timeout. */
  async wait(
    name: string,
    timeoutMs = 30 * 60 * 1000,
    pollMs = 10_000,
  ): Promise<Date> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = backupState(await this.get(name));
      if (state.state === "completed") {
        return state.completedAt;
      }
      if (state.state === "failed") {
        throw new Error(`Velero backup ${name} failed: ${state.reason}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Velero backup ${name} did not complete in ${String(timeoutMs / 60_000)} minutes`,
        );
      }
      await this.sleep(pollMs);
    }
  }
}
