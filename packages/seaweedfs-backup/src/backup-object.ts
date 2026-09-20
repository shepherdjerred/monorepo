import { createHash } from "node:crypto";
import type { ObjectHeaders } from "./schemas.ts";
import type { ObjectStore, StoredObject } from "./store.ts";

const DESTINATION_READ_ATTEMPTS = 6;

export const OPAQUE_OBJECT_HEADERS: ObjectHeaders = {
  contentType: "application/octet-stream",
  metadata: {},
};

export async function hashStoredObject(
  object: StoredObject,
  onBytes?: (bytes: number) => void,
): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of object.body) {
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) {
      throw new TypeError("Object stream emitted an unsupported chunk type");
    }
    const value =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    hash.update(value);
    bytes += value.byteLength;
    onBytes?.(bytes);
  }
  return { sha256: hash.digest("hex"), bytes };
}

function isObjectNotVisible(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NoSuchKey" || error.name === "NotFound")
  );
}

export async function getUploadedObject(input: {
  destination: ObjectStore;
  backupBucket: string;
  backupObjectKey: string;
}): Promise<StoredObject> {
  for (let attempt = 1; attempt <= DESTINATION_READ_ATTEMPTS; attempt += 1) {
    try {
      return await input.destination.getObject(
        input.backupBucket,
        input.backupObjectKey,
      );
    } catch (error: unknown) {
      if (attempt === DESTINATION_READ_ATTEMPTS || !isObjectNotVisible(error)) {
        throw error;
      }
      await Bun.sleep(250 * attempt);
    }
  }
  throw new Error("Destination read retry loop exited unexpectedly");
}

/**
 * Attempts per object when the transport, rather than the object, fails.
 *
 * A multi-hour transfer loses a connection sooner or later, and an
 * `ECONNRESET` partway through a large bucket used to end the whole run: the
 * Activity retries, but its unit is the entire run, so three attempts spend
 * hours re-copying from the start and still produce no manifest. Retrying the
 * object costs seconds instead.
 *
 * Repeating a copy is safe — the destination key is the content hash, so a
 * partial upload is overwritten rather than appended to, and the read-back
 * verification still gates the result. This sits outside `copyOrReuseObject`
 * so that its source-version handling keeps its own budget: a connection reset
 * is not evidence that the source moved.
 */
const TRANSPORT_ATTEMPTS = 4;

/**
 * Whether a failure describes the connection rather than the data.
 *
 * Matches the shape of `isObjectNotVisible` in `backup-object.ts`: node's
 * socket errors carry a `code`, and the S3 client surfaces aborted requests by
 * name. Anything unrecognised is treated as a real failure and propagates.
 */
export function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code: unknown = Reflect.get(error, "code");
  if (
    typeof code === "string" &&
    ["ECONNRESET", "ECONNABORTED", "EPIPE", "ETIMEDOUT", "ENOTFOUND"].includes(
      code,
    )
  ) {
    return true;
  }
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    error.message === "aborted" ||
    error.message.includes("socket hang up") ||
    error.message.includes("ECONNRESET")
  );
}

/**
 * Run `operation`, retrying it while the transport rather than the data is at
 * fault. `describe` names the work in the error raised once attempts run out.
 */
export async function withTransportRetry<T>(
  operation: () => Promise<T>,
  delay: (milliseconds: number) => Promise<void>,
  describe: () => string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      // Only the transport is worth another attempt. A source that keeps
      // moving, or bytes that come back different from what was sent, describe
      // data rather than a connection, and `copyOrReuseObject` and the
      // verification inside it have already had their say.
      if (!isTransportFailure(error)) throw error;
      lastError = error;
      if (attempt === TRANSPORT_ATTEMPTS) break;
      await delay(1000 * 2 ** (attempt - 1));
    }
  }
  throw new Error(
    `SeaweedFS backup could not ${describe()} after ${String(TRANSPORT_ATTEMPTS)} transport attempts`,
    { cause: lastError },
  );
}
