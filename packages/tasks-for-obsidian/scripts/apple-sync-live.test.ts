import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  assertOwnedSimulator,
  settledProfile,
  verifyReplica,
} from "./apple-sync-live/model";

const runID = "1d09432f-45c4-4392-a320-3ac199963410";
const profileID = "36c78fb0-92dd-4e48-ab2a-cce6986bb8d5";
const simulatorID = "779ad93d-d55b-467e-a5d7-61740c521514";
const now = Date.parse("2026-10-11T12:00:00.000Z");
const directories: string[] = [];

function status() {
  return {
    schemaVersion: 1,
    runID,
    capturedAt: new Date(now).toISOString(),
    accountStage: "vaults",
    accountBusy: false,
    accountExchange: null,
    profiles: [
      {
        profileID,
        profileKind: "obsidian_sync",
        remoteVaultID: "owned-vault",
        phase: "synced",
        transport: "connected",
        hostWorkPending: false,
        durable: {
          schemaVersion: 1,
          profileId: profileID,
          profileKind: "obsidian_sync",
          version: 7,
          initialSyncComplete: true,
          pendingRemoteCount: 0,
          pendingUploadCount: 0,
          conflictCount: 0,
          pendingMutationCount: 0,
        },
      },
    ],
  };
}

afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("live synchronization completion", () => {
  test("accepts only a current exact-bound cloud profile", () => {
    expect(settledProfile(status(), runID, "owned-vault", now).profileID).toBe(
      profileID,
    );
  });
  test("rejects stale, future and wrong-run evidence", () => {
    expect(() =>
      settledProfile(status(), crypto.randomUUID(), "owned-vault", now),
    ).toThrow("Wrong acceptance run");
    expect(() =>
      settledProfile(status(), runID, "owned-vault", now + 5001),
    ).toThrow("Stale");
    expect(() =>
      settledProfile(status(), runID, "owned-vault", now - 1001),
    ).toThrow("Stale");
  });
  test("rejects the wrong remote vault and a local-folder profile", () => {
    expect(() => settledProfile(status(), runID, "other-vault", now)).toThrow(
      "Wrong acceptance vault",
    );
    const local = status();
    const profile = local.profiles[0];
    if (profile === undefined) throw new Error("Missing test profile");
    profile.profileKind = "local_folder";
    expect(() => settledProfile(local, runID, "owned-vault", now)).toThrow(
      "Wrong acceptance vault",
    );
  });
  test.each([
    "pendingRemoteCount",
    "pendingUploadCount",
    "conflictCount",
    "pendingMutationCount",
  ] as const)("rejects nonzero %s even when host says synced", (key) => {
    const value = status();
    const profile = value.profiles[0];
    if (profile === undefined) throw new Error("Missing test profile");
    profile.durable[key] = 1;
    expect(() => settledProfile(value, runID, "owned-vault", now)).toThrow(
      "not settled",
    );
  });
  test("rejects host work, unfinished discovery and mismatched durable profile", () => {
    const value = status();
    const profile = value.profiles[0];
    if (profile === undefined) throw new Error("Missing test profile");
    profile.hostWorkPending = true;
    expect(() => settledProfile(value, runID, "owned-vault", now)).toThrow(
      "not settled",
    );
    profile.hostWorkPending = false;
    profile.durable.initialSyncComplete = false;
    expect(() => settledProfile(value, runID, "owned-vault", now)).toThrow(
      "not settled",
    );
    profile.durable.initialSyncComplete = true;
    profile.durable.profileId = crypto.randomUUID();
    expect(() => settledProfile(value, runID, "owned-vault", now)).toThrow(
      "matching durable",
    );
  });
  test("shared schema rejects unknown/private fields", () => {
    expect(() =>
      settledProfile(
        { ...status(), token: "forbidden" },
        runID,
        "owned-vault",
        now,
      ),
    ).toThrow("contract");
    const value = status();
    const profile = value.profiles[0];
    if (profile === undefined) throw new Error("Missing test profile");
    profile.durable.pendingUploadCount = -1;
    expect(() => settledProfile(value, runID, "owned-vault", now)).toThrow(
      "contract",
    );
  });
});

async function replica() {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "facet-live-validator-"),
  );
  const directory = await realpath(temporary);
  directories.push(directory);
  await mkdir(path.join(directory, "Attachments"));
  const bytes = new Uint8Array([0, 255, 3, 4]);
  await Bun.write(path.join(directory, "Attachments/binary.bin"), bytes);
  return {
    directory,
    expected: {
      "Attachments/binary.bin": {
        size: bytes.length,
        sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      },
    },
  };
}

describe("replica byte preservation", () => {
  test("checks binary hashes and detects unexpected notes", async () => {
    const { directory, expected } = await replica();
    await expect(verifyReplica(directory, expected)).resolves.toBeUndefined();
    await Bun.write(path.join(directory, "Unexpected.md"), "duplicate");
    await expect(verifyReplica(directory, expected)).rejects.toThrow(
      "unexpected vault paths",
    );
  });
  test("rejects a same-size binary mutation", async () => {
    const { directory, expected } = await replica();
    await Bun.write(
      path.join(directory, "Attachments/binary.bin"),
      new Uint8Array([0, 254, 3, 4]),
    );
    await expect(verifyReplica(directory, expected)).rejects.toThrow(
      "Replica mismatch",
    );
  });
  test("rejects traversal and symlinked files", async () => {
    const { directory, expected } = await replica();
    const fingerprint = expected["Attachments/binary.bin"];
    await expect(
      verifyReplica(directory, { "../escaped": fingerprint }),
    ).rejects.toThrow("Unsafe expected");
    await symlink(
      path.join(directory, "Attachments/binary.bin"),
      path.join(directory, "Link.bin"),
    );
    await expect(
      verifyReplica(directory, { "Link.bin": fingerprint }),
    ).rejects.toThrow("Unsafe vault file");
  });
});

describe("simulator ownership", () => {
  const owned = { id: simulatorID, name: `Facet Live Sync ${runID}` };
  const available = {
    devices: { runtime: [{ udid: simulatorID, name: owned.name }] },
  };
  test("accepts an exact manifest-owned UUID/name", () => {
    expect(() => assertOwnedSimulator(runID, owned, available)).not.toThrow();
  });
  test("rejects existing user devices, reused names and vanished UUIDs", () => {
    expect(() =>
      assertOwnedSimulator(
        runID,
        { ...owned, name: "iPhone personal" },
        available,
      ),
    ).toThrow("unowned");
    expect(() =>
      assertOwnedSimulator(crypto.randomUUID(), owned, available),
    ).toThrow("unowned");
    expect(() =>
      assertOwnedSimulator(
        runID,
        { ...owned, id: crypto.randomUUID() },
        available,
      ),
    ).toThrow("ownership");
    expect(() =>
      assertOwnedSimulator(runID, owned, {
        devices: { runtime: [{ udid: simulatorID, name: "iPhone personal" }] },
      }),
    ).toThrow("ownership");
  });
});
