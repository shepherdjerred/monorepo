import { parseArgs } from "node:util";
import { createNarrowReader } from "@shepherdjerred/delivery/client";
import { listCompletionMarkers } from "@shepherdjerred/seaweedfs-backup/manifest";
import { SEAWEEDFS_BACKUP_POLICY } from "@shepherdjerred/seaweedfs-backup/policy";
import { restoreSnapshot } from "@shepherdjerred/seaweedfs-backup/restore";
import {
  restoreStoreFromEnvironment,
  storesFromEnvironment,
} from "@shepherdjerred/seaweedfs-backup/store";
import { verifySnapshot } from "@shepherdjerred/seaweedfs-backup/verify";
import { openColdStartRecord } from "#lib/backup/cold-start-record.ts";
import {
  parseDeliveryReplicationTarget,
  pendingServiceArtifacts,
  replicateDeliveryArtifact,
} from "#lib/backup/delivery-replication.ts";
import { resolveCredentials } from "#lib/credentials.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { deliveryClient, deliveryUrl } from "#lib/delivery/client.ts";

const USAGE = `
toolkit backup seaweedfs snapshots
toolkit backup seaweedfs verify --snapshot <id> [--full]
toolkit backup seaweedfs pending-delivery --service <id>
toolkit backup seaweedfs replicate-delivery --artifact <id> --service <id> --digest <sha256>
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

async function deliveryExecutorClient() {
  const config = await loadToolkitConfig();
  await resolveCredentials(["DELIVERY_EXECUTOR_TOKEN"]);
  const url = deliveryUrl(await config.value("deliveryUrl"));
  const token = required(
    Bun.env["DELIVERY_EXECUTOR_TOKEN"],
    "DELIVERY_EXECUTOR_TOKEN",
  );
  const client = deliveryClient(url, token);
  const read = createNarrowReader({
    baseUrl: url,
    headers: { Authorization: `Bearer ${token}` },
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      }),
  });
  return {
    recordReplication: client.recordReplication,
    pendingForService: (serviceId: string) =>
      pendingServiceArtifacts(read, serviceId),
  };
}

async function replicateDeliveryCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      artifact: { type: "string" },
      service: { type: "string" },
      digest: { type: "string" },
    },
    allowPositionals: false,
  });
  const target = parseDeliveryReplicationTarget({
    artifactId: required(values.artifact, "--artifact"),
    serviceId: required(values.service, "--service"),
    digest: required(values.digest, "--digest"),
  });
  const client = await deliveryExecutorClient();
  const result = await replicateDeliveryArtifact(target, client);
  console.log(
    JSON.stringify({
      artifactId: result.id,
      digest: result.digest,
      replication: result.replication,
    }),
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
    case "replicate-delivery":
      await replicateDeliveryCommand(actionArgs);
      break;
    case "pending-delivery": {
      const { values } = parseArgs({
        args: actionArgs,
        options: { service: { type: "string" } },
        allowPositionals: false,
      });
      const service = required(values.service, "--service");
      const client = await deliveryExecutorClient();
      const artifacts = await client.pendingForService(service);
      console.log(
        JSON.stringify(
          artifacts.map(({ id, serviceId, digest, uri, buildId }) => ({
            id,
            serviceId,
            digest,
            uri,
            buildId,
          })),
        ),
      );
      break;
    }
    case "restore":
      await restoreCommand(actionArgs);
      break;
    case undefined:
      throw new Error("A SeaweedFS backup action is required");
    default:
      throw new Error(`Unknown SeaweedFS backup action: ${action}`);
  }
}
