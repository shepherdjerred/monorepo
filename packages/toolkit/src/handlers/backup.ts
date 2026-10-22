import { parseArgs } from "node:util";
import { listCompletionMarkers } from "@shepherdjerred/seaweedfs-backup/manifest";
import { SEAWEEDFS_BACKUP_POLICY } from "@shepherdjerred/seaweedfs-backup/policy";
import { restoreSnapshot } from "@shepherdjerred/seaweedfs-backup/restore";
import {
  restoreStoreFromEnvironment,
  storesFromEnvironment,
} from "@shepherdjerred/seaweedfs-backup/store";
import { verifySnapshot } from "@shepherdjerred/seaweedfs-backup/verify";
import { openColdStartRecord } from "#lib/backup/cold-start-record.ts";

const USAGE = `
toolkit backup seaweedfs snapshots
toolkit backup seaweedfs verify --snapshot <id> [--full]
toolkit backup seaweedfs restore --snapshot <id> --bucket <name> --destination-bucket <empty-bucket>
toolkit backup seaweedfs restore --cold-start --record <new-file> --snapshot <id> --bucket <name> --destination-bucket <name>
`;

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

async function snapshotsCommand(): Promise<void> {
  const { destination, backupBucket } = storesFromEnvironment();
  const markers = await listCompletionMarkers(destination, backupBucket);
  if (markers.length === 0) {
    console.log("No completed SeaweedFS backup snapshots.");
    return;
  }
  for (const marker of markers) {
    const objectCount = marker.manifests.reduce(
      (total, manifest) => total + manifest.objectCount,
      0,
    );
    const protectedBytes = marker.manifests.reduce(
      (total, manifest) => total + manifest.protectedBytes,
      0,
    );
    console.log(
      `${marker.snapshotId} ${marker.cadence} ${marker.completedAt} ${String(marker.manifests.length)} buckets ${String(objectCount)} objects ${String(protectedBytes)} bytes`,
    );
  }
}

async function verifyCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      snapshot: { type: "string" },
      full: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const { destination, backupBucket } = storesFromEnvironment();
  const result = await verifySnapshot({
    store: destination,
    backupBucket,
    snapshotId: required(values.snapshot, "--snapshot"),
    full: values.full,
  });
  console.log(
    `Verified ${result.snapshotId}: ${String(result.manifests)} manifests, ${String(result.checkedObjects)} objects present, ${String(result.hashedObjects)} checksums`,
  );
}

async function restoreCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      snapshot: { type: "string" },
      bucket: { type: "string" },
      "destination-bucket": { type: "string" },
      "cold-start": { type: "boolean", default: false },
      record: { type: "string" },
    },
    allowPositionals: false,
  });
  const coldStart = values["cold-start"];
  if (
    coldStart &&
    (values.record === undefined || values.record.length === 0)
  ) {
    throw new Error("--record <file> is required with --cold-start");
  }
  if (!coldStart && values.record !== undefined) {
    throw new Error("--record is only valid with --cold-start");
  }
  const request = {
    destinationBucket: required(
      values["destination-bucket"],
      "--destination-bucket",
    ),
    sourceBucket: required(values.bucket, "--bucket"),
    snapshotId: required(values.snapshot, "--snapshot"),
  };
  const { destination, backupBucket } = storesFromEnvironment();
  const destinationStore = restoreStoreFromEnvironment();
  const record =
    coldStart && values.record !== undefined
      ? await openColdStartRecord(values.record, {
          type: "cold-start-restore",
          ...request,
          startedAt: new Date().toISOString(),
        })
      : undefined;
  try {
    const result = await restoreSnapshot({
      backupStore: destination,
      destinationStore,
      backupBucket,
      ...request,
      policy: SEAWEEDFS_BACKUP_POLICY,
      coldStart,
      ...(record === undefined
        ? {}
        : {
            onObjectRestored: (object) =>
              record.append({ type: "object", ...object }),
          }),
    });
    await record?.append({
      type: "complete",
      ...result,
      completedAt: new Date().toISOString(),
    });
    console.log(
      `Restored and verified ${String(result.restoredObjects)} objects (${String(result.restoredBytes)} bytes)`,
    );
  } catch (error: unknown) {
    await record?.append({
      type: "failed",
      error: error instanceof Error ? error.message : String(error),
      failedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    await record?.close();
  }
}

export async function handleBackupCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(USAGE);
    return;
  }
  if (subcommand !== "seaweedfs") {
    throw new Error(`Unknown backup target: ${subcommand}`);
  }
  const action = args[0];
  const actionArgs = args.slice(1);
  switch (action) {
    case "snapshots":
      await snapshotsCommand();
      break;
    case "verify":
      await verifyCommand(actionArgs);
      break;
    case "restore":
      await restoreCommand(actionArgs);
      break;
    case undefined:
      throw new Error("A SeaweedFS backup action is required");
    default:
      throw new Error(`Unknown SeaweedFS backup action: ${action}`);
  }
}
