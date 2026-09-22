import { createHash } from "node:crypto";
import type { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ManifestEntry, ObjectHeaders } from "./schemas.ts";
import type { ListedObject, ObjectStore, StoredObject } from "./store.ts";

const DESTINATION_READ_ATTEMPTS = 6;
const TRANSIENT_OPERATION_ATTEMPTS = 12;
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export const OPAQUE_OBJECT_HEADERS: ObjectHeaders = {
  contentType: "application/octet-stream",
  metadata: {},
};

export type CopyAttemptState = {
  uploaded: boolean;
};

export type CopyResult = {
  entry: ManifestEntry;
  copied: boolean;
};

export function getConditionalSourceObject(input: {
  source: ObjectStore;
  sourceBucket: string;
  sourceObject: ListedObject;
}): Promise<StoredObject> {
  return input.source.getObject(input.sourceBucket, input.sourceObject.key, {
    etag: input.sourceObject.etag,
    unmodifiedSince: input.sourceObject.lastModified,
  });
}

function streamError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Object upload failed", { cause: error });
}

async function awaitUploadWithPipelineCancellation(
  upload: Promise<void>,
  hashingStream: Transform,
): Promise<void> {
  try {
    await upload;
  } catch (error: unknown) {
    hashingStream.destroy(streamError(error));
    throw error;
  }
}

export async function uploadOpaqueObject(input: {
  destination: ObjectStore;
  backupBucket: string;
  backupObjectKey: string;
  sourceBody: Readable;
  hashingStream: Transform;
  contentLength: number;
}): Promise<void> {
  const upload = input.destination.putObject({
    bucket: input.backupBucket,
    key: input.backupObjectKey,
    body: input.hashingStream,
    contentLength: input.contentLength,
    headers: OPAQUE_OBJECT_HEADERS,
  });
  const uploadWithPipelineCancellation = awaitUploadWithPipelineCancellation(
    upload,
    input.hashingStream,
  );
  const [streamResult, uploadResult] = await Promise.allSettled([
    pipeline(input.sourceBody, input.hashingStream),
    uploadWithPipelineCancellation,
  ]);
  if (uploadResult.status === "rejected") throw uploadResult.reason;
  if (streamResult.status === "rejected") throw streamResult.reason;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

function isTransientObjectStoreError(error: unknown): boolean {
  return (
    TRANSIENT_ERROR_CODES.has(errorCode(error) ?? "") ||
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        error.message === "aborted" ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("socket hang up")))
  );
}

export async function withTransientObjectStoreRetries<Result>(
  operation: () => Promise<Result>,
  onWait?: () => void,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
    Bun.sleep(milliseconds),
  describe: () => string = () => "complete an object operation",
): Promise<Result> {
  for (let attempt = 1; attempt <= TRANSIENT_OPERATION_ATTEMPTS; attempt += 1) {
    const heartbeat =
      onWait === undefined ? undefined : setInterval(onWait, 30_000);
    try {
      return await operation();
    } catch (error: unknown) {
      if (!isTransientObjectStoreError(error)) throw error;
      if (attempt === TRANSIENT_OPERATION_ATTEMPTS) {
        throw new Error(
          `SeaweedFS backup could not ${describe()} after ${String(TRANSIENT_OPERATION_ATTEMPTS)} transient transport attempts`,
          { cause: error },
        );
      }
      onWait?.();
      await delay(Math.min(500 * attempt, 3000));
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat);
    }
  }
  throw new Error("Transient object operation retry loop exited unexpectedly");
}

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

export async function hashStoredObjectPair(input: {
  source: StoredObject;
  destination: StoredObject;
  onSourceBytes?: (bytes: number) => void;
  onDestinationBytes?: (bytes: number) => void;
}): Promise<{
  source: { sha256: string; bytes: number };
  destination: { sha256: string; bytes: number };
}> {
  const [sourceResult, destinationResult] = await Promise.allSettled([
    hashStoredObject(input.source, input.onSourceBytes),
    hashStoredObject(input.destination, input.onDestinationBytes),
  ]);
  if (sourceResult.status === "rejected") throw sourceResult.reason;
  if (destinationResult.status === "rejected") throw destinationResult.reason;
  return { source: sourceResult.value, destination: destinationResult.value };
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
