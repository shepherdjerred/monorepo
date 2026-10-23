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

function write(writtenAt: string, catalog = "c") {
  return {
    deploymentId: `deployment-${writtenAt}`,
    fingerprint: `sha256:${catalog.repeat(64)}`,
    snapshot: {
      writtenAt,
      catalogRevision: `sha256:${catalog.repeat(64)}`,
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

  it("orders snapshots of one millisecond by their microseconds", async () => {
    const { store, objects, latest } = memoryStore();
    const newer = "2026-10-23T06:00:00.123700Z";
    const older = "2026-10-23T06:00:00.123400Z";
    await writeColdStartObjects(store, write(newer, "a"));
    const archive = await writeColdStartObjects(store, write(older, "b"));
    expect(latest()).toBe(newer);
    expect(objects.has(archive)).toBe(true);
  });

  it("refuses a different snapshot with the pointer's write time", async () => {
    const { store, objects, latest } = memoryStore();
    const at = "2026-10-23T06:00:00.123000Z";
    const first = await writeColdStartObjects(store, write(at, "a"));
    await expect(writeColdStartObjects(store, write(at, "b"))).rejects.toThrow(
      /latest.json already holds a different snapshot written at/u,
    );
    expect(latest()).toBe(at);
    expect([...objects.keys()].toSorted()).toEqual(
      [first, COLD_START_SNAPSHOT.key].toSorted(),
    );
    // The same snapshot again is the same write.
    expect(await writeColdStartObjects(store, write(at, "a"))).toBe(first);
  });

  it("never overwrites an immutable copy with other bytes", async () => {
    const { store, objects, latest } = memoryStore();
    const older = "2026-10-23T06:00:00.123000Z";
    const newer = "2026-10-23T06:05:00.000000Z";
    const archive = await writeColdStartObjects(store, write(older));
    const archived = objects.get(archive);
    await writeColdStartObjects(store, write(newer));
    // Another snapshot under the older copy's key is refused.
    const other = write(older);
    await expect(
      writeColdStartObjects(store, {
        ...other,
        snapshot: {
          ...other.snapshot,
          environments: [
            {
              environmentId: "arcade/prod",
              deploymentId: "deployment-other",
              acceptedAt: older,
              selection: {
                versionSetRevisionId: "arcade/set",
                recipeRevisionId: "arcade/1",
                configurationRevisionId: "arcade/config",
              },
              artifacts: {},
            },
          ],
        },
      }),
    ).rejects.toThrow(
      /already holds a different snapshot; it is never overwritten/u,
    );
    expect(objects.get(archive)).toBe(archived);
    expect(latest()).toBe(newer);
  });
});
