import assert from "node:assert/strict";
import { lstat, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  FileBlobSchema,
  RelativePathSchema,
  SHA256Schema,
  UuidSchema,
} from "../fields.ts";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";

export const liveShare = "/Volumes/My Shared Files/exports";
export const liveGuestBun = "/Volumes/My Shared Files/tools/bun";
export const helperFiles = [
  "mac-process-owner.swift",
  "mac-process-owner.schema.json",
  "account-main.swift",
  "AccountRuntime.swift",
  "AccountOwner.swift",
  "AccountLifecycle.swift",
  "official-account.swift",
  "OfficialOwner.swift",
  "OfficialVerification.swift",
  "official-verification.protocol.json",
] as const;
export const LiveConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runID: UuidSchema,
  buildID: UuidSchema,
  scope: z.enum(["macos", "apple"]),
  packageRoot: z.string().startsWith("/"),
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
  artifactSHA256: SHA256Schema,
  payloadSHA256: SHA256Schema,
  liveBundleSHA256: SHA256Schema,
  sourceFiles: z.record(RelativePathSchema, SHA256Schema),
  helpers: z.record(z.enum(helperFiles), SHA256Schema),
  seed: z.record(RelativePathSchema, FileBlobSchema),
  officialApp: z.strictObject({
    exportID: UuidSchema,
    archiveSHA256: SHA256Schema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }),
});
export type LiveConfig = z.infer<typeof LiveConfigSchema>;

export function guestLivePaths(config: LiveConfig, home = os.homedir()) {
  assert.equal(path.normalize(home), home);
  assert.ok(path.isAbsolute(home));
  const packageRoot = path.resolve(config.packageRoot, "../tasks-for-obsidian");
  const evidenceDirectory = path.join(
    packageRoot,
    ".build/live-sync",
    config.runID,
  );
  const container = path.join(
    home,
    "Library/Containers/red.sjer.tasknotes.mac.acceptance/Data",
  );
  const stateDirectory = path.join(
    container,
    "Library/Application Support/FacetAcceptance",
    config.runID,
  );
  return {
    packageRoot,
    evidenceDirectory,
    container,
    stateDirectory,
    descriptor: path.join(stateDirectory, "acceptance.json"),
    referenceDirectory: path.join(evidenceDirectory, "reference-vault"),
    products: path.join(evidenceDirectory, "macos/Build/Products"),
    app: path.join(
      evidenceDirectory,
      "macos/Build/Products/Debug/FacetAcceptance.app",
    ),
    officialApp: path.join(
      home,
      "Applications/FacetAcceptanceReference",
      config.officialApp.exportID,
      "Obsidian.app",
    ),
  };
}

export async function ownedLiveDirectory(directory: string): Promise<void> {
  assert.equal(await realpath(directory), directory);
  const stat = await lstat(directory);
  assert.ok(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.uid === process.getuid?.(),
  );
  assert.equal(stat.mode & 0o022, 0);
}

export async function readLiveConfig(
  exportRoot: string,
  expectedSHA: string,
): Promise<LiveConfig> {
  SHA256Schema.parse(expectedSHA);
  const file = path.join(exportRoot, "live-config.json");
  assert.equal(await macFileSHA(file), expectedSHA);
  const config = LiveConfigSchema.parse(
    await readOwnedMacVMJSON(file, 16 * 1024 * 1024),
  );
  assert.equal(await macFileSHA(file), expectedSHA);
  assert.equal(exportRoot, path.join(liveShare, config.buildID));
  assert.equal(
    await macFileSHA(path.join(exportRoot, "live-guest.js")),
    config.liveBundleSHA256,
  );
  assert.equal(
    await macFileSHA(path.join(exportRoot, "artifact.json")),
    config.artifactSHA256,
  );
  assert.equal(
    await macFileSHA(path.join(exportRoot, "payload.json")),
    config.payloadSHA256,
  );
  for (const name of helperFiles)
    assert.equal(
      await macFileSHA(path.join(exportRoot, "live-helpers", name)),
      config.helpers[name],
    );
  return config;
}
