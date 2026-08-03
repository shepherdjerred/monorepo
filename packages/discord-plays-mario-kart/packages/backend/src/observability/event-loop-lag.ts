// Manual event-loop-lag sampler. Bun's node:perf_hooks
// monitorEventLoopDelay() exists but does not register synchronous blocks
// (verified 2026-08-03: a 40ms busy-loop reported max 1.2ms), so stalls are
// measured the direct way: a 20ms interval timer whose observed period exceeds
// its schedule by the amount the loop was blocked.
const SAMPLE_INTERVAL_MS = 20;
// Ignore sub-ms scheduling noise so the histogram measures stalls, not timer
// jitter.
const MIN_REPORTED_LAG_MS = 1;

/**
 * Starts sampling this thread's event-loop lag, reporting each stall's excess
 * milliseconds to `observe`. The timer is unref'd — it never keeps the
 * process or Worker alive. Returns a stop function.
 */
export function startEventLoopLagSampler(
  observe: (lagMs: number) => void,
): () => void {
  let last = performance.now();
  const timer = setInterval(() => {
    const nowTs = performance.now();
    const lag = nowTs - last - SAMPLE_INTERVAL_MS;
    last = nowTs;
    if (lag >= MIN_REPORTED_LAG_MS) observe(lag);
  }, SAMPLE_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
