/**
 * Older dispatch histories recorded with the retired replication marker
 * still schedule this activity. Nothing awaits an off-cluster replica any
 * more, so it lists nothing; Velero's scheduled backups are the only backup.
 */
export function listDeliveryReplications(): Promise<{ artifacts: [] }> {
  return Promise.resolve({ artifacts: [] });
}
