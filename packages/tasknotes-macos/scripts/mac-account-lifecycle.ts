import assert from "node:assert/strict";
import path from "node:path";
import { LifecycleCheckpointSchema } from "../../tasks-for-obsidian/scripts/apple-sync-live/recovery.ts";
import { outboxSnapshot } from "../../tasks-for-obsidian/scripts/apple-sync-live/outbox.ts";
import {
  StatusSchema,
  type Manifest,
  validate,
  verifyReplica,
} from "../../tasks-for-obsidian/scripts/apple-sync-live/model.ts";
import { replicaDirectory } from "../../tasks-for-obsidian/scripts/apple-sync-live/native.ts";
import { verifyVaultEndpoint } from "../../tasks-for-obsidian/scripts/apple-sync-live/replicas/access.ts";

export function lifecycleCheckpoint(
  manifest: Manifest,
  value: unknown,
  round: number,
) {
  const checkpoint = LifecycleCheckpointSchema.parse(value);
  assert.ok(manifest.schemaVersion === 2 || manifest.schemaVersion === 3);
  assert.equal(manifest.stage, "initial-verified");
  assert.equal(checkpoint.runID, manifest.runID);
  assert.equal(checkpoint.round, manifest.round);
  assert.equal(checkpoint.round, round);
  assert.equal(checkpoint.outbox.count, checkpoint.pendingCount);
  return checkpoint;
}

export function assertLifecycleEvidence(
  manifest: Manifest,
  checkpoint: ReturnType<typeof lifecycleCheckpoint>,
  value: unknown,
  outbox: { count: number; sha256: string },
  interruption: unknown,
  reauthorized = false,
  now = Date.now(),
) {
  validate("status", value);
  validate("interruption", interruption);
  const status = StatusSchema.parse(value);
  assert.equal(status.runID.toLowerCase(), manifest.runID.toLowerCase());
  const age = now - Date.parse(status.capturedAt);
  assert.ok(age >= -1000 && age <= 5000);
  assert.equal(status.accountBusy, false);
  assert.equal(status.profiles.length, 1);
  const profile = status.profiles[0];
  assert.ok(profile !== undefined);
  assert.equal(profile.profileID, checkpoint.profileID);
  assert.equal(profile.profileKind, "obsidian_sync");
  assert.equal(profile.remoteVaultID, manifest.allowedRemoteVaultID);
  assert.equal(profile.phase, reauthorized ? "offline" : "reconnectRequired");
  assert.equal(
    profile.transport,
    reauthorized ? "offline" : "reconnectRequired",
  );
  assert.equal(profile.hostWorkPending, false);
  assert.ok(profile.durable !== null);
  assert.equal(profile.durable.profileId, checkpoint.profileID);
  assert.equal(profile.durable.profileKind, "obsidian_sync");
  assert.equal(profile.durable.initialSyncComplete, true);
  assert.equal(profile.durable.pendingUploadCount, checkpoint.pendingCount);
  assert.equal(profile.durable.pendingRemoteCount, 0);
  assert.equal(profile.durable.pendingMutationCount, 0);
  assert.equal(profile.durable.conflictCount, 0);
  assert.deepEqual(outbox, checkpoint.outbox);
  assert.ok(
    typeof interruption === "object" &&
      interruption !== null &&
      "runID" in interruption &&
      typeof interruption.runID === "string" &&
      "profileIDs" in interruption,
  );
  assert.equal(interruption.runID.toLowerCase(), manifest.runID.toLowerCase());
  assert.deepEqual(interruption.profileIDs, [checkpoint.profileID]);
}

export async function verifyLifecycleReplica(
  manifest: Manifest,
  checkpoint: ReturnType<typeof lifecycleCheckpoint>,
) {
  if (manifest.schemaVersion === 3) {
    await verifyVaultEndpoint(
      manifest,
      { client: "macos", profileID: checkpoint.profileID },
      checkpoint.expected,
    );
  } else {
    await verifyReplica(
      replicaDirectory(manifest, "macos", checkpoint.profileID),
      checkpoint.expected,
    );
  }
  return outboxSnapshot(manifest, "macos", checkpoint.profileID);
}

export function checkpointPath(directory: string) {
  return path.join(directory, "lifecycle-macos-checkpoint.json");
}
