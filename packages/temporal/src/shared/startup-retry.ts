export const STARTUP_RETRY_INITIAL_DELAY_MS = 10_000;
export const STARTUP_RETRY_MAXIMUM_DELAY_MS = 300_000;
export const STARTUP_RETRY_ESCALATION_ATTEMPT = 10;

export type RetrySleep = (
  delayMs: number,
  isClosed: () => boolean,
) => Promise<void>;

export type StartupRetryFailure = {
  readonly attempt: number;
  readonly delayMs: number;
  readonly error: unknown;
};

export type StartupRetryInput = {
  readonly operation: () => Promise<void>;
  readonly shouldRetry: (error: unknown) => boolean;
  readonly isClosed: () => boolean;
  readonly sleep?: RetrySleep;
  readonly random?: () => number;
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly onRetry?: (failure: StartupRetryFailure) => void;
  readonly onEscalate?: (failure: StartupRetryFailure) => void;
};

export type StartupRetryResult = "succeeded" | "closed";

export function equalJitterRetryDelayMs(
  attempt: number,
  randomValue: number,
  initialDelayMs = STARTUP_RETRY_INITIAL_DELAY_MS,
  maximumDelayMs = STARTUP_RETRY_MAXIMUM_DELAY_MS,
): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error(
      `retry attempt must be a positive integer, got ${String(attempt)}`,
    );
  }
  if (randomValue < 0 || randomValue > 1 || !Number.isFinite(randomValue)) {
    throw new Error(
      `retry random value must be between 0 and 1, got ${String(randomValue)}`,
    );
  }
  if (initialDelayMs <= 0 || maximumDelayMs < initialDelayMs) {
    throw new Error("retry delay bounds are invalid");
  }

  const exponentialDelay = Math.min(
    maximumDelayMs,
    initialDelayMs * 2 ** (attempt - 1),
  );
  return Math.round(
    exponentialDelay / 2 + randomValue * (exponentialDelay / 2),
  );
}

export async function sleepUnlessClosed(
  delayMs: number,
  isClosed: () => boolean,
  sleep: (delayMs: number) => Promise<void> = Bun.sleep,
): Promise<void> {
  const deadline = Date.now() + delayMs;
  while (!isClosed() && Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    await sleep(Math.min(remainingMs, 1000));
  }
}

export async function retryUntilReady(
  input: StartupRetryInput,
): Promise<StartupRetryResult> {
  const sleep: RetrySleep =
    input.sleep ??
    ((delayMs, isClosed) => sleepUnlessClosed(delayMs, isClosed));
  const random = input.random ?? Math.random;
  let attempt = 0;

  while (!input.isClosed()) {
    try {
      await input.operation();
      return "succeeded";
    } catch (error: unknown) {
      if (input.isClosed()) {
        return "closed";
      }
      if (!input.shouldRetry(error)) {
        throw error;
      }

      attempt += 1;
      const failure: StartupRetryFailure = {
        attempt,
        delayMs: equalJitterRetryDelayMs(
          attempt,
          random(),
          input.initialDelayMs,
          input.maximumDelayMs,
        ),
        error,
      };
      input.onRetry?.(failure);
      if (attempt === STARTUP_RETRY_ESCALATION_ATTEMPT) {
        input.onEscalate?.(failure);
      }
      await sleep(failure.delayMs, input.isClosed);
    }
  }

  return "closed";
}
