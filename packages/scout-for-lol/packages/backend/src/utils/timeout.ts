const API_TIMEOUT_MS = 30_000;

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`API request timed out after ${timeoutMs.toString()}ms`),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
