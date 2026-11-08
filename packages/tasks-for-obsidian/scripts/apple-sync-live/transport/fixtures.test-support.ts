import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { GuestManifest } from "./host.ts";
import type { GuestPaths } from "./owned-files.ts";
import type { GuestDispatcherOptions } from "./guest.ts";

export const runID = "12345678-1234-4234-9234-123456789abc";
export const binding = {
  runID,
  round: 1,
  allowedRemoteVaultID: "synthetic-vault",
};
export const manifest: GuestManifest = {
  schemaVersion: 3,
  ...binding,
  execution: {
    kind: "tart-guest",
    vm: "facet-macos-acceptance",
    guestRunID: runID,
    artifactBuildID: runID,
    guestBundlePath: `/Volumes/My Shared Files/exports/${runID}/live-guest.js`,
    guestBundleSHA256: "a".repeat(64),
    guestConfigSHA256: "b".repeat(64),
    artifactSHA256: "c".repeat(64),
    payloadSHA256: "d".repeat(64),
  },
};

export async function guestDirectories(roots: string[], prefix: string) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  const paths: GuestPaths = {
    stateDirectory: path.join(root, "state"),
    referenceDirectory: path.join(root, "reference"),
    evidenceDirectory: path.join(root, "evidence"),
  };
  for (const directory of Object.values(paths)) await mkdir(directory);
  return { root, paths };
}

export function dispatcherOptions(paths: GuestPaths): GuestDispatcherOptions {
  return {
    paths,
    binding,
    authorize: () => Promise.resolve(),
    preflight: () => Promise.resolve(),
    execute: () => Promise.reject(new Error("No execution hook expected")),
  };
}

export function emptyStatus() {
  return {
    schemaVersion: 1,
    runID,
    capturedAt: new Date().toISOString(),
    accountStage: "credentials",
    accountBusy: false,
    accountExchange: null,
    profiles: [],
  };
}
