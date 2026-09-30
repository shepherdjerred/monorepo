import { proxyActivities } from "@temporalio/workflow";
import type { BackupCadence } from "@shepherdjerred/seaweedfs-backup/schemas";
import type { SeaweedFsBackupActivities } from "#activities/homelab/seaweedfs-backup.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";

const activities = proxyActivities<SeaweedFsBackupActivities>({
  taskQueue: TASK_QUEUES.BACKUP,
  startToCloseTimeout: "20 hours",
  heartbeatTimeout: "2 minutes",
  retry: {
    maximumAttempts: 3,
    initialInterval: "5 minutes",
    backoffCoefficient: 2,
    maximumInterval: "30 minutes",
  },
});

export async function runSeaweedFsBackupWorkflow(input: {
  cadence: BackupCadence;
}): Promise<{ snapshotId: string; buckets: number }> {
  return activities.runSeaweedFsBackup(input);
}

export async function runSeaweedFsBackupRetentionAndGcWorkflow(): Promise<{
  deletedSnapshots: number;
  deletedObjects: number;
  candidateObjects: number;
}> {
  return activities.runSeaweedFsBackupRetentionAndGc();
}
