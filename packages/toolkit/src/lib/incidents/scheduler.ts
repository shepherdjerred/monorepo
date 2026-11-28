/**
 * Time source and one-shot timers for incident waits. Waits schedule a single
 * timer for the next known deadline (takeover eligibility or lease expiry)
 * instead of polling; tests drive a fake clock through the same interface.
 */
export type Scheduler = {
  readonly now: () => number;
  /** Run `callback` once at `at` (epoch ms); returns a cancel function. */
  readonly at: (at: number, callback: () => void) => () => void;
};

export const realScheduler: Scheduler = {
  now: () => Date.now(),
  at: (at, callback) => {
    const timer = setTimeout(callback, Math.max(0, at - Date.now()));
    return () => {
      clearTimeout(timer);
    };
  },
};

/** Resolve after `ms` on the scheduler's clock, or early when `signal` aborts. */
export async function pause(
  scheduler: Scheduler,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      cancel();
      signal.removeEventListener("abort", done);
      resolve();
    };
    const cancel = scheduler.at(scheduler.now() + ms, done);
    signal.addEventListener("abort", done, { once: true });
  });
}
