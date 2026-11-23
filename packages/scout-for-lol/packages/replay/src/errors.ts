import { ReplayRuntimeError, type ReplayErrorListener } from "./types.ts";

function inactiveSubscription(): void {
  // A failed or disposed session retains no active error subscription.
}

export function createReplayErrors(onFailure: ReplayErrorListener) {
  const listeners = new Set<ReplayErrorListener>();
  let closed = false;
  let failure: ReplayRuntimeError | null = null;
  return {
    fail: (cause: unknown) => {
      if (closed || failure !== null) return;
      failure =
        cause instanceof ReplayRuntimeError
          ? cause
          : new ReplayRuntimeError(cause);
      const pending = [...listeners];
      listeners.clear();
      onFailure(failure);
      for (const listener of pending) listener(failure);
    },
    subscribe: (listener: ReplayErrorListener) => {
      if (failure !== null) {
        listener(failure);
        return inactiveSubscription;
      }
      if (closed) return inactiveSubscription;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      closed = true;
      listeners.clear();
    },
  };
}
