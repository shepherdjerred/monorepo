import { homedir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import {
  ManifestSchema,
  requiredCases,
} from "../../tasks-for-obsidian/scripts/apple-sync-live/model.ts";
import {
  assertLifecycleEvidence,
  lifecycleCheckpoint,
} from "./mac-account-lifecycle.ts";
import { bindingFor, parseArguments } from "./mac-account-contract.ts";

const runID = "11111111-1111-4111-a111-111111111abc";
const profileID = "22222222-2222-4222-A222-222222222ABC";
const remote = "synthetic-remote";
const container = path.join(
  homedir(),
  "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data",
);
const stateDirectory = path.join(
  container,
  "Library/Application Support/FacetAcceptance",
  runID,
);
const client = {
  container,
  stateDirectory,
  descriptor: path.join(stateDirectory, "acceptance.json"),
};
const descriptor = {
  schemaVersion: 1,
  runID,
  stateDirectory,
  allowedRemoteVaultID: remote,
};
const manifest = ManifestSchema.parse({
  schemaVersion: 2,
  scope: "macos",
  runID,
  createdAt: "2026-10-12T00:00:00Z",
  round: 2,
  failures: [],
  completedRounds: [],
  operations: { "lifecycle-begin:macos": "pass" },
  stage: "initial-verified",
  allowedRemoteVaultID: remote,
  reference: {},
  pluginFixtureSHA256: "a".repeat(64),
  cases: Object.fromEntries(
    requiredCases.map((name) => [
      name,
      ["official-reference", "initial-download"].includes(name)
        ? "pass"
        : "pending",
    ]),
  ),
  simulator: null,
  clients: { macos: client },
});
const checkpoint = {
  schemaVersion: 1,
  runID,
  round: 2,
  profileID,
  pendingCount: 1,
  outbox: { count: 1, sha256: "b".repeat(64) },
  title: "Synthetic lifecycle task",
  expected: {},
};
const durable = {
  schemaVersion: 1,
  profileId: profileID,
  profileKind: "obsidian_sync",
  version: 3,
  initialSyncComplete: true,
  pendingRemoteCount: 0,
  pendingUploadCount: 1,
  conflictCount: 0,
  pendingMutationCount: 0,
};
const profile = {
  profileID,
  profileKind: "obsidian_sync",
  remoteVaultID: remote,
  phase: "reconnectRequired",
  transport: "reconnectRequired",
  durable,
  hostWorkPending: false,
};
const status = {
  schemaVersion: 1,
  runID: runID.toUpperCase(),
  capturedAt: "2026-10-12T00:00:00Z",
  profiles: [profile],
  accountStage: "credentials",
  accountBusy: false,
  accountExchange: null,
};
const interruption = {
  schemaVersion: 1,
  runID: runID.toUpperCase(),
  profileIDs: [profileID],
};
const now = Date.parse(status.capturedAt);
const parsed = lifecycleCheckpoint(manifest, checkpoint, 2);

test("lifecycle mode is explicit and binds the retained begin checkpoint in this round", () => {
  expect(
    parseArguments([runID, "present", "--lifecycle-round", "2"]).lifecycleRound,
  ).toBe(2);
  expect(() =>
    parseArguments([runID, "present", "--lifecycle-round", "02"]),
  ).toThrow();
  expect(() => bindingFor(runID, manifest, descriptor)).toThrow();
  expect(() => bindingFor(runID, manifest, descriptor, 2)).not.toThrow();
  expect(() => bindingFor(runID, manifest, descriptor, 1)).toThrow();
  expect(() =>
    bindingFor(runID, { ...manifest, operations: {} }, descriptor, 2),
  ).toThrow();
  expect(() =>
    bindingFor(
      runID,
      {
        ...manifest,
        operations: {
          ...manifest.operations,
          "lifecycle-finish:macos": "pass",
        },
      },
      descriptor,
      2,
    ),
  ).toThrow();
});

test("checkpoint rejects another run, round, inconsistent count or unknown top-level field", () => {
  for (const invalid of [
    { ...checkpoint, runID: crypto.randomUUID() },
    { ...checkpoint, round: 1 },
    { ...checkpoint, pendingCount: 2 },
    { ...checkpoint, profileID: "../another-profile" },
    { ...checkpoint, extra: true },
  ])
    expect(() => lifecycleCheckpoint(manifest, invalid, 2)).toThrow();
});

test("original reconnect-required profile retains exact immutable pending outbox", () => {
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      status,
      checkpoint.outbox,
      interruption,
      false,
      now,
    ),
  ).not.toThrow();
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      status,
      { count: 1, sha256: "c".repeat(64) },
      interruption,
      false,
      now,
    ),
  ).toThrow();
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      status,
      { count: 0, sha256: checkpoint.outbox.sha256 },
      interruption,
      false,
      now,
    ),
  ).toThrow();
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      status,
      checkpoint.outbox,
      { ...interruption, profileIDs: [] },
      false,
      now,
    ),
  ).toThrow();
});

test("duplicate, replaced, wrong-vault and changed durable profiles block reauthentication", () => {
  for (const profiles of [
    [profile, profile],
    [],
    [{ ...profile, profileID: crypto.randomUUID() }],
    [{ ...profile, remoteVaultID: "another-remote" }],
    [{ ...profile, durable: { ...durable, profileId: crypto.randomUUID() } }],
    [{ ...profile, durable: { ...durable, pendingUploadCount: 0 } }],
    [{ ...profile, durable: { ...durable, pendingMutationCount: 1 } }],
    [{ ...profile, hostWorkPending: true }],
    [{ ...profile, phase: "offline", transport: "offline" }],
  ])
    expect(() =>
      assertLifecycleEvidence(
        manifest,
        parsed,
        { ...status, profiles },
        checkpoint.outbox,
        interruption,
        false,
        now,
      ),
    ).toThrow();
});

test("post-reauthorization proof requires original profile offline with unchanged outbox and interruption", () => {
  const reauthorized = {
    ...status,
    profiles: [{ ...profile, phase: "offline", transport: "offline" }],
  };
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      reauthorized,
      checkpoint.outbox,
      interruption,
      true,
      now,
    ),
  ).not.toThrow();
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      status,
      checkpoint.outbox,
      interruption,
      true,
      now,
    ),
  ).toThrow();
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      {
        ...reauthorized,
        profiles: [{ ...profile, phase: "synced", transport: "connected" }],
      },
      checkpoint.outbox,
      interruption,
      true,
      now,
    ),
  ).toThrow();
  expect(() =>
    assertLifecycleEvidence(
      manifest,
      parsed,
      reauthorized,
      checkpoint.outbox,
      interruption,
      true,
      now + 5001,
    ),
  ).toThrow();
});
