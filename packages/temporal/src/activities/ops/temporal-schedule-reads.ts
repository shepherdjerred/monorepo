import { AsyncLocalStorage } from "node:async_hooks";

export type ScheduleRead = <T>(operation: () => Promise<T>) => Promise<T>;

/** One budget and eight read slots across every monitored namespace. */
export async function withScheduleReads<T>(
  operation: (scope: {
    read: ScheduleRead;
    signal: AbortSignal;
    deadline: number;
  }) => Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(timeoutMs),
    ...(options.signal === undefined ? [] : [options.signal]),
  ]);
  let active = 0;
  const waiting: (() => void)[] = [];
  const rejections = new Set<(reason: Error) => void>();
  const abortReason = (): Error => {
    const reason: unknown = signal.reason;
    return reason instanceof Error
      ? reason
      : new Error("Temporal schedule reads aborted", { cause: reason });
  };
  const abort = () => {
    waiting.length = 0;
    for (const reject of rejections) reject(abortReason());
    rejections.clear();
  };
  signal.addEventListener("abort", abort, { once: true });
  const read: ScheduleRead = <R>(readOperation: () => Promise<R>) => {
    signal.throwIfAborted();
    // Queued work may be released by the other namespace. Preserve the submitting
    // connection's RPC cancellation/deadline context instead of inheriting its slot.
    const runInContext = AsyncLocalStorage.snapshot();
    return new Promise<R>((resolve, reject) => {
      rejections.add(reject);
      const finish = () => {
        rejections.delete(reject);
        active -= 1;
        waiting.shift()?.();
      };
      const start = () => {
        if (signal.aborted) {
          rejections.delete(reject);
          reject(abortReason());
          return;
        }
        active += 1;
        void runInContext(async () => {
          try {
            resolve(await readOperation());
          } catch (error: unknown) {
            reject(
              error instanceof Error
                ? error
                : new Error("Temporal schedule read failed", { cause: error }),
            );
          } finally {
            finish();
          }
        });
      };
      if (active < 8) start();
      else waiting.push(start);
    });
  };
  try {
    signal.throwIfAborted();
    const result = await operation({
      read,
      signal,
      deadline: Date.now() + timeoutMs,
    });
    signal.throwIfAborted();
    return result;
  } finally {
    controller.abort();
    signal.removeEventListener("abort", abort);
  }
}
