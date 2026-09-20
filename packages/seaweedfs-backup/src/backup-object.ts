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
