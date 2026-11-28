type DeliveryFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [
  1000, 2000, 4000, 8000, 12_000, 15_000, 20_000, 30_000,
] as const;

/**
 * Retries transient Delivery 5xx (including 503 PAUSED during cutover) and
 * transport failures across bounded backoff steps while leaving 4xx fail-fast.
 */
export function createRetryingDeliveryFetch(options?: {
  fetch?: DeliveryFetch;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
}): DeliveryFetch {
  const transport = options?.fetch ?? fetch;
  const wait = options?.sleep ?? ((ms) => Bun.sleep(ms));
  const delays = options?.delaysMs ?? RETRY_DELAYS_MS;
  return async (input, init) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await transport(input, init);
        const delay = delays[attempt];
        if (delay === undefined || !TRANSIENT_STATUSES.has(response.status))
          return response;
        await response.body?.cancel();
        console.warn(
          `Delivery API returned ${String(response.status)} (attempt ${String(attempt + 1)}/${String(delays.length + 1)}); retrying in ${String(delay)}ms`,
        );
        await wait(delay);
      } catch (error) {
        const delay = delays[attempt];
        if (delay === undefined) throw error;
        console.warn(
          `Delivery API transport failed (${error instanceof Error ? error.message : String(error)}, attempt ${String(attempt + 1)}/${String(delays.length + 1)}); retrying in ${String(delay)}ms`,
        );
        await wait(delay);
      }
    }
  };
}
