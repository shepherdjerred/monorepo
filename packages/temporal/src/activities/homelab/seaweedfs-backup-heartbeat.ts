import type {
  BackupMaintenanceHooks,
  BackupMaintenanceProgress,
} from "@shepherdjerred/seaweedfs-backup/maintenance";

type ActivityHeartbeatContext<Progress> = {
  cancellationSignal: AbortSignal;
  heartbeat: (details: Progress) => void;
};

/** Keep long maintenance I/O alive and stop writes when its Activity expires. */
export async function withBackupMaintenanceHeartbeat<Result>(
  context: ActivityHeartbeatContext<BackupMaintenanceProgress>,
  operation: (hooks: Required<BackupMaintenanceHooks>) => Promise<Result>,
): Promise<Result> {
  return withBackupActivityHeartbeat(context, operation, {
    stage: "snapshot-inventory",
    completed: 0,
  });
}

/** Cover inventory and publication waits as well as per-object copy progress. */
export async function withBackupActivityHeartbeat<
  Result,
  Progress extends { stage: string },
>(
  context: ActivityHeartbeatContext<Progress>,
  operation: (hooks: {
    signal: AbortSignal;
    onProgress: (progress: Progress) => void;
  }) => Promise<Result>,
  initialProgress: Progress,
  heartbeatEveryProgress = false,
): Promise<Result> {
  const heartbeatFailure = new AbortController();
  const signal = AbortSignal.any([
    context.cancellationSignal,
    heartbeatFailure.signal,
  ]);
  let progress = initialProgress;
  const heartbeat = (): void => {
    if (signal.aborted) return;
    try {
      context.heartbeat(progress);
    } catch (error: unknown) {
      heartbeatFailure.abort(error);
    }
  };
  const onProgress = (next: Progress): void => {
    signal.throwIfAborted();
    const changedStage = next.stage !== progress.stage;
    progress = next;
    if (changedStage || heartbeatEveryProgress) heartbeat();
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
