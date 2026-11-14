/**
 * Longest a worker process may outlive its completed drain. It bounds only
 * the cleanup after every Worker's `run()` has settled (servers, connections,
 * telemetry flush); the drain itself keeps the pod's full termination grace.
 */
export const POST_DRAIN_EXIT_MS = 10_000;

/**
 * Backstop for a handle nothing closed. A terminating pod is released only
 * when its process exits, so a worker that idles after its drain holds a
 * `Recreate` rollout for the whole termination grace. The timer is
 * unreferenced: a process with nothing left open exits on its own first.
 */
export function exitAfterDrain(options: {
  graceMs?: number;
  onForcedExit: (fields: { graceMs: number }) => void;
}): void {
  const graceMs = options.graceMs ?? POST_DRAIN_EXIT_MS;
  const timer = setTimeout(() => {
    options.onForcedExit({ graceMs });
    process.exit(1);
  }, graceMs);
  timer.unref();
}
