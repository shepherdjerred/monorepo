import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type {
  ObjectStore,
  PutObjectInput,
} from "@shepherdjerred/seaweedfs-backup/store";
import { COLD_START_SNAPSHOT } from "@shepherdjerred/delivery/model-contract";
import { writeColdStartObjects } from "./cold-start.ts";

/** The R2 bucket as a map of keys to the bytes last written there. */
function memoryStore() {
  const objects = new Map<string, Uint8Array>();
  const listed = (key: string) => {
    const bytes = objects.get(key);
    return bytes === undefined
      ? undefined
      : { key, size: bytes.byteLength, etag: "etag", lastModified: new Date() };
  };
  const store: ObjectStore = {
    listBuckets: () => Promise.reject(new Error("unused")),
    listObjects: () => Promise.reject(new Error("unused")),
    deleteObject: () => Promise.reject(new Error("unused")),
    headObject: (_bucket, key) => Promise.resolve(listed(key)),
    getObject: (_bucket, key) => {
      const head = listed(key);
      const bytes = objects.get(key);
      if (head === undefined || bytes === undefined)
        return Promise.reject(new Error(`No object ${key}`));
      return Promise.resolve({
        ...head,
        body: Readable.from([bytes]),
        headers: { metadata: {} },
      });
    },
    putObject: (input: PutObjectInput) => {
      if (!(input.body instanceof Uint8Array))
        return Promise.reject(new Error("Expected bytes"));
      objects.set(input.key, input.body);
      return Promise.resolve();
    },
  };
  const latest = () => {
    const bytes = objects.get(COLD_START_SNAPSHOT.key);
    return bytes === undefined
      ? undefined
      : snapshotWrittenAt(new TextDecoder().decode(bytes));
  };
  return { store, objects, latest };
}

function snapshotWrittenAt(text: string): string {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || !("writtenAt" in parsed))
    throw new Error("Not a snapshot");
  return String(parsed.writtenAt);
}

function write(writtenAt: string) {
  return {
    deploymentId: `deployment-${writtenAt}`,
    fingerprint: `sha256:${"f".repeat(64)}`,
    snapshot: {
      writtenAt,
      catalogRevision: `sha256:${"c".repeat(64)}`,
      environments: [],
    },
  };
}

describe("cold-start snapshot writes (section 6)", () => {
  it("never moves latest.json back to an older snapshot a retry rewrites", async () => {
    const { store, objects, latest } = memoryStore();
    const older = "2026-10-23T06:00:00.000Z";
    const newer = "2026-10-23T06:05:00.000Z";
    await writeColdStartObjects(store, write(older));
    expect(latest()).toBe(older);
    await writeColdStartObjects(store, write(newer));
    expect(latest()).toBe(newer);
    // The older Activity retried after the newer acceptance wrote.
    const archive = await writeColdStartObjects(store, write(older));
    expect(latest()).toBe(newer);
    // Its immutable copy is still written.
    expect(objects.has(archive)).toBe(true);
    // A replay of the newest snapshot rewrites the same pointer.
    await writeColdStartObjects(store, write(newer));
    expect(latest()).toBe(newer);
  });
});
