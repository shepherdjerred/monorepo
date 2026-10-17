import { expect, test } from "vitest";
import {
  assertOfflinePending,
  assertUnchangedOfflineOutbox,
} from "./offline-proof";

const profileID = "1d09432f-45c4-4392-a320-3ac199963410";
const vaultID = "owned-vault";
const outbox = { count: 1, sha256: "a".repeat(64) };
function profile() {
  return {
    profileID,
    profileKind: "obsidian_sync",
    remoteVaultID: vaultID,
    phase: "offline",
    transport: "offline",
    hostWorkPending: false,
    durable: {
      schemaVersion: 1,
      profileId: profileID,
      profileKind: "obsidian_sync",
      version: 7,
      initialSyncComplete: true,
      pendingRemoteCount: 0,
      pendingUploadCount: 1,
      conflictCount: 0,
      pendingMutationCount: 0,
    },
  };
}
test("offline recovery requires an actual disconnected, bound durable upload before resume", () => {
  expect(assertOfflinePending(profile(), profileID, vaultID, outbox)).toEqual(
    outbox,
  );
  for (const patch of [
    { phase: "synced", transport: "connected" },
    { transport: "connected" },
    { profileID: crypto.randomUUID() },
    { remoteVaultID: "another-vault" },
    { profileKind: "local_folder" },
    { durable: { ...profile().durable, profileId: crypto.randomUUID() } },
    { durable: { ...profile().durable, pendingUploadCount: 0 } },
  ])
    expect(() =>
      assertOfflinePending(
        { ...profile(), ...patch },
        profileID,
        vaultID,
        outbox,
      ),
    ).toThrow();
});
test("offline proof rejects drained, mismatched, or replaced outbox operations", () => {
  for (const snapshot of [
    { ...outbox, count: 0 },
    { ...outbox, count: 2 },
    { ...outbox, sha256: "invalid" },
  ])
    expect(() =>
      assertOfflinePending(profile(), profileID, vaultID, snapshot),
    ).toThrow();
  expect(() => assertUnchangedOfflineOutbox(outbox, outbox)).not.toThrow();
  expect(() =>
    assertUnchangedOfflineOutbox(outbox, { ...outbox, sha256: "b".repeat(64) }),
  ).toThrow("changed before");
  expect(() =>
    assertUnchangedOfflineOutbox(outbox, { ...outbox, count: 2 }),
  ).toThrow("changed before");
});
