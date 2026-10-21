import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InMemoryObjectStore } from "@shepherdjerred/seaweedfs-backup/testing/in-memory-store";
import { readObjectBytes } from "@shepherdjerred/seaweedfs-backup/store";
import type * as BackupStore from "@shepherdjerred/seaweedfs-backup/store";
import { deliveryReplicationActivities } from "./copy.ts";

const support = await vi.hoisted(
  () => import("#activities/testing/seaweedfs-backup-activity.ts"),
);
const { activity, resetBackupActivity } = support;
vi.mock("@temporalio/activity", support.activityContextModule);
vi.mock("@shepherdjerred/seaweedfs-backup/store", support.backupStoreModule);

const SOURCE_BUCKET = "delivery-artifacts";
const BACKUP_BUCKET = "seaweedfs-backups";
const SOURCE_KEY = "sites/sjer.red/41.tar";
const CONTENT = "frozen site archive";
const SHA256 = createHash("sha256").update(CONTENT).digest("hex");
let source: InMemoryObjectStore;
let destination: InMemoryObjectStore;
let execution: BackupStore.ObjectStoreExecution | undefined;

beforeEach(() => {
  source = new InMemoryObjectStore();
  source.createBucket(SOURCE_BUCKET);
  source.seed(SOURCE_BUCKET, SOURCE_KEY, CONTENT);
  destination = new InMemoryObjectStore();
  destination.createBucket(BACKUP_BUCKET);
  execution = undefined;
  resetBackupActivity((options) => {
    execution = options;
    return { source, destination, backupBucket: BACKUP_BUCKET };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("replicateDeliveryObject", () => {
  test("copies the artifact into the backup layout and returns the receipt fields", async () => {
    const replica = await deliveryReplicationActivities.replicateDeliveryObject(
      {
        sourceBucket: SOURCE_BUCKET,
        sourceKey: SOURCE_KEY,
        expectedSha256: SHA256,
      },
    );
    expect(replica).toEqual({
      backupBucket: BACKUP_BUCKET,
      backupObjectKey: expect.stringMatching(/^objects\/[a-f0-9]{64}$/u),
      sha256: SHA256,
    });
    const copied = await destination.getObject(
      BACKUP_BUCKET,
      replica.backupObjectKey,
    );
    expect(new TextDecoder().decode(await readObjectBytes(copied))).toBe(
      CONTENT,
    );
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
        sourceBucket: SOURCE_BUCKET,
        sourceKey: SOURCE_KEY,
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
    expect(await destination.listObjects(BACKUP_BUCKET)).toEqual([]);
  });
});
