import { isTransientError } from "../transient.ts";

const MAX_ATTEMPTS = 3;

export class CiObjectStoreHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CiObjectStoreHttpError";
  }
}

/** Retry a complete idempotent GET or PUT, recreating its signed request. */
export async function withCiObjectStoreRetry<T>(
  operation: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<unknown> = Bun.sleep,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const transient =
        error instanceof CiObjectStoreHttpError
          ? error.status >= 500 && error.status < 600
          : isTransientError(error);
      if (!transient || attempt === MAX_ATTEMPTS) throw error;
      console.warn(
        `Transient CI object-store transfer failure; retrying (${String(attempt + 1)}/${String(MAX_ATTEMPTS)})`,
      );
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error("CI object-store retry loop exhausted without an outcome");
}
