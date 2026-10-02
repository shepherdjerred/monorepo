import type {
  BackupMaintenanceHooks,
  BackupMaintenanceProgress,
} from "@shepherdjerred/seaweedfs-backup/maintenance";

type ActivityHeartbeatContext = {
  cancellationSignal: AbortSignal;
  heartbeat: (details: BackupMaintenanceProgress) => void;
};

/** Keep long maintenance I/O alive and stop writes when its Activity expires. */
export async function withBackupMaintenanceHeartbeat<Result>(
  context: ActivityHeartbeatContext,
  operation: (hooks: Required<BackupMaintenanceHooks>) => Promise<Result>,
): Promise<Result> {
  const heartbeatFailure = new AbortController();
  const signal = AbortSignal.any([
    context.cancellationSignal,
    heartbeatFailure.signal,
  ]);
  let progress: BackupMaintenanceProgress = {
    stage: "snapshot-inventory",
    completed: 0,
  };
  const heartbeat = (): void => {
    if (signal.aborted) return;
    try {
      context.heartbeat(progress);
    } catch (error: unknown) {
      heartbeatFailure.abort(error);
    }
  };
  const onProgress = (next: BackupMaintenanceProgress): void => {
    signal.throwIfAborted();
    const changedStage = next.stage !== progress.stage;
    progress = next;
    if (changedStage) heartbeat();
    signal.throwIfAborted();
  };
  signal.throwIfAborted();
  heartbeat();
  const interval = setInterval(heartbeat, 30_000);
  try {
    signal.throwIfAborted();
    const result = await operation({ signal, onProgress });
    signal.throwIfAborted();
    return result;
  } finally {
    clearInterval(interval);
  }
}
