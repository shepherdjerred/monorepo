type ActivityHeartbeatContext<Progress> = {
  cancellationSignal: AbortSignal;
  heartbeat: (details: Progress) => void;
};

/**
 * Heartbeat a long Activity every 30 seconds and on each stage change, and
 * abort its I/O when the Activity is cancelled or a heartbeat fails.
 */
export async function withActivityHeartbeat<
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
