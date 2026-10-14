export async function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
  label: string,
): Promise<T> {
  signal.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(new DOMException(`${label} canceled`, "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    clearTimeout(timer);
    if (abort !== undefined) signal.removeEventListener("abort", abort);
  }
}
