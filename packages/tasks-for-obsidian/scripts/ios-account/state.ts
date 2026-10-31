import assert from "node:assert/strict";
import path from "node:path";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { assertFreshInitialStatus } from "tasknotes-macos/scripts/mac-account-contract.ts";
import {
  assertLifecycleEvidence,
  lifecycleCheckpoint,
} from "tasknotes-macos/scripts/mac-account-lifecycle.ts";
import { assertUnchangedBuild } from "../apple-sync-live/ledger";
import {
  clientState,
  runDirectory,
  StatusSchema,
  validate,
  type Manifest,
} from "../apple-sync-live/model";
import { readManifest } from "../apple-sync-live/platform";
import { outboxSnapshot } from "../apple-sync-live/outbox";
import { verifyVaultEndpoint } from "../apple-sync-live/replicas/access";

export async function iosControlStatus(manifest: Manifest) {
  const state = clientState(manifest, "ios");
  const value = await readOwnedMacVMJSON(
    path.join(state.stateDirectory, "control/status.json"),
  );
  validate("status", value);
  const status = StatusSchema.parse(value);
  assert.equal(status.runID.toLowerCase(), manifest.runID.toLowerCase());
  const age = Date.now() - Date.parse(status.capturedAt);
  assert.ok(age >= -1000 && age <= 5000, "Private iOS account status is stale");
  return status;
}

export async function accountCheckpoint(
  manifest: Manifest,
  round: number | undefined,
) {
  if (round === undefined) return;
  assert.equal(manifest.operations["lifecycle-begin:ios"], "pass");
  assert.equal(manifest.operations["lifecycle-finish:ios"], undefined);
  return lifecycleCheckpoint(
    manifest,
    await readOwnedMacVMJSON(
      path.join(runDirectory(manifest.runID), "lifecycle-ios-checkpoint.json"),
    ),
    round,
  );
}

type Checkpoint = Awaited<ReturnType<typeof accountCheckpoint>>;

export async function validateAccountState(
  manifest: Manifest,
  checkpoint: Checkpoint,
  reauthorized = false,
) {
  const current = await readManifest(manifest.runID);
  assert.equal(
    current.schemaVersion,
    3,
    "Private iOS account entry requires its explicit guest live run",
  );
  assert.equal(current.allowedRemoteVaultID, manifest.allowedRemoteVaultID);
  assert.equal(current.round, manifest.round);
  assert.equal(current.failures.length, 0);
  assert.equal(current.cases["official-reference"], "pass");
  assert.equal(
    current.stage,
    checkpoint === undefined ? "bound" : "initial-verified",
  );
  if (manifest.schemaVersion === 3)
    assert.deepEqual(current.execution, manifest.execution);
  await assertUnchangedBuild(current);
  const status = await iosControlStatus(current);
  if (checkpoint === undefined) {
    if (reauthorized) assertConnectedProfile(current, status);
    else assertFreshInitialStatus(status, current.runID);
  } else {
    const saved = await accountCheckpoint(current, checkpoint.round);
    assert.deepEqual(
      saved,
      checkpoint,
      "The original iOS lifecycle checkpoint changed",
    );
    await verifyVaultEndpoint(
      current,
      { client: "ios", profileID: checkpoint.profileID },
      checkpoint.expected,
    );
    const outbox = await outboxSnapshot(current, "ios", checkpoint.profileID);
    const interruption = await readOwnedMacVMJSON(
      path.join(
        clientState(current, "ios").stateDirectory,
        "control/interruption.json",
      ),
    );
    assertLifecycleEvidence(
      current,
      checkpoint,
      status,
      outbox,
      interruption,
      reauthorized,
    );
  }
  Object.assign(manifest, current);
  return status;
}

function assertConnectedProfile(
  manifest: Manifest,
  status: ReturnType<typeof StatusSchema.parse>,
) {
  assert.equal(status.accountBusy, false);
  assert.equal(status.profiles.length, 1);
  const profile = status.profiles[0];
  assert.ok(
    profile?.profileKind === "obsidian_sync" &&
      profile.remoteVaultID === manifest.allowedRemoteVaultID,
  );
  assert.ok(
    profile.durable !== null &&
      profile.durable.profileId === profile.profileID &&
      profile.durable.profileKind === "obsidian_sync",
  );
  assert.notEqual(profile.phase, "failed");
  // Initial download and queue drainage are verified by the unchanged live matrix.
}
