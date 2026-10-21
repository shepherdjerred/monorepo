import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type * as BackupStore from "@shepherdjerred/seaweedfs-backup/store";
import { deliveryReplicationActivities } from "./copy.ts";

const activity = vi.hoisted(() => ({
  cancellation: new AbortController(),
  heartbeat: vi.fn(),
  stores: vi.fn(),
}));

vi.mock("@temporalio/activity", () => ({
  Context: {
    current: () => ({
      cancellationSignal: activity.cancellation.signal,
      heartbeat: activity.heartbeat,
    }),
  },
}));

vi.mock("@shepherdjerred/seaweedfs-backup/store", async (importOriginal) => ({
  ...(await importOriginal<typeof BackupStore>()),
  storesFromEnvironment: activity.stores,
}));

type MemoryObject = { bytes: Uint8Array; etag: string; lastModified: Date };

async function readBody(body: Readable | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    if (typeof chunk === "string") chunks.push(new TextEncoder().encode(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new TypeError("Unsupported in-memory stream chunk");
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function memoryStore(seed: Record<string, string> = {}) {
  const objects = new Map<string, MemoryObject>();
  for (const [key, value] of Object.entries(seed)) {
    const bytes = new TextEncoder().encode(value);
    objects.set(key, {
      bytes,
      etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
      lastModified: new Date("2026-10-20T00:00:00.000Z"),
    });
  }
  const listed = (
    key: string,
    object: MemoryObject,
  ): BackupStore.ListedObject => ({
    key,
    size: object.bytes.byteLength,
    etag: object.etag,
    lastModified: object.lastModified,
  });
  const store: BackupStore.ObjectStore = {
    listBuckets: () => Promise.resolve([]),
    listObjects: () =>
      Promise.resolve([...objects].map(([key, object]) => listed(key, object))),
    headObject: (_bucket, key) => {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined ? undefined : listed(key, object),
      );
    },
    getObject: (_bucket, key) => {
      const object = objects.get(key);
      if (object === undefined) {
        const error = new Error(`NoSuchKey: ${key}`);
        error.name = "NoSuchKey";
        throw error;
      }
      return Promise.resolve({
        ...listed(key, object),
        body: Readable.from([object.bytes]),
        headers: { contentType: "application/octet-stream", metadata: {} },
      });
    },
    putObject: async (input) => {
      const bytes = await readBody(input.body);
      objects.set(input.key, {
        bytes,
        etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
        lastModified: new Date(),
      });
    },
    deleteObject: () => {
      throw new Error("Unexpected delete during replication");
    },
  };
  return { store, objects };
}

const CONTENT = "frozen site archive";
const SHA256 = createHash("sha256").update(CONTENT).digest("hex");
let source: ReturnType<typeof memoryStore>;
let destination: ReturnType<typeof memoryStore>;
let execution: BackupStore.ObjectStoreExecution | undefined;

beforeEach(() => {
  source = memoryStore({ "sites/sjer.red/41.tar": CONTENT });
  destination = memoryStore();
  execution = undefined;
  activity.cancellation = new AbortController();
  activity.heartbeat.mockReset();
  activity.stores.mockReset();
  activity.stores.mockImplementation(
    (_environment: unknown, options?: BackupStore.ObjectStoreExecution) => {
      execution = options;
      return {
        source: source.store,
        destination: destination.store,
        backupBucket: "seaweedfs-backups",
      };
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replicateDeliveryObject", () => {
  test("copies the artifact into the backup layout and returns the receipt fields", async () => {
    const replica = await deliveryReplicationActivities.replicateDeliveryObject(
      {
        sourceBucket: "delivery-artifacts",
        sourceKey: "sites/sjer.red/41.tar",
        expectedSha256: SHA256,
      },
    );
    expect(replica).toEqual({
      backupBucket: "seaweedfs-backups",
      backupObjectKey: expect.stringMatching(/^objects\/[a-f0-9]{64}$/u),
      sha256: SHA256,
    });
    const copied = destination.objects.get(replica.backupObjectKey);
    expect(copied && new TextDecoder().decode(copied.bytes)).toBe(CONTENT);
    expect(execution?.signal).toBeInstanceOf(AbortSignal);
    expect(activity.heartbeat).toHaveBeenCalledWith({
      stage: "copy",
      bucket: "delivery-artifacts",
      bytes: 0,
    });
    expect(activity.heartbeat).toHaveBeenLastCalledWith({
      stage: "verify",
      bucket: "delivery-artifacts",
      bytes: CONTENT.length,
    });
  });

  test("refuses bytes whose digest differs from the artifact digest", async () => {
    await expect(
      deliveryReplicationActivities.replicateDeliveryObject({
        sourceBucket: "delivery-artifacts",
        sourceKey: "sites/sjer.red/41.tar",
        expectedSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(
      `has sha256 ${SHA256} but the expected digest is ${"0".repeat(64)}`,
    );
  });

  test("fails when the artifact no longer exists in the self-hosted store", async () => {
    await expect(
      deliveryReplicationActivities.replicateDeliveryObject({
        sourceBucket: "delivery-artifacts",
        sourceKey: "sites/sjer.red/missing.tar",
        expectedSha256: SHA256,
      }),
    ).rejects.toThrow(
      "delivery-artifacts/sites/sjer.red/missing.tar does not exist",
    );
    expect(destination.objects.size).toBe(0);
  });
});
