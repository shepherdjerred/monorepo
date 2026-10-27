import assert from "node:assert/strict";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  macFileSHA,
  macUUID,
  materializeMacArtifact,
  readMacArtifact,
  verifyMacArtifact,
  type MacArtifact,
} from "./mac-artifact.ts";
import { buildMacArtifact, type MacJourneyCommand } from "./mac-journey.ts";
import { retireMacRun } from "./native-owner.ts";
import type { RunBinding } from "./retained-owner.ts";
import { readExactHandle } from "./owned-handle.ts";
import {
  requireStableSources,
  sourceFingerprints,
} from "./source-provenance.ts";

export type MacVMExport = {
  artifact: MacArtifact;
  directory: string;
  payloadSHA256: string;
  bundleSHA256: string;
};
export type MacVMCaptureIdentity = {
  payloadSHA256: string;
  installationID: string;
  bundlePath: string;
  sourceHead: string;
};

export async function readOwnedMacVMJSON(
  file: string,
  maximumBytes = 4 * 1024 * 1024,
): Promise<unknown> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    assert.ok(
      metadata.isFile() &&
        metadata.uid === process.getuid?.() &&
        (metadata.mode & 0o022) === 0,
    );
    assert.ok(
      metadata.size > 0 && metadata.size <= maximumBytes,
      "VM metadata exceeds its bound",
    );
    const bytes = await readExactHandle(handle, metadata.size, maximumBytes);
    const after = await handle.stat();
    assert.equal(after.size, metadata.size);
    assert.equal(after.mtimeMs, metadata.mtimeMs);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await handle.close();
  }
}

function readinessReceipt(expected: MacVMCaptureIdentity, runID: string) {
  return { schemaVersion: 1, status: "capture-ready", ...expected, runID };
}
export function requireMacVMCaptureReady(
  raw: unknown,
  expected: MacVMCaptureIdentity,
): void {
  assert.ok(
    raw !== null && typeof raw === "object" && !Array.isArray(raw),
    "Run --setup-capture with this exact artifact first",
  );
  const runID: unknown = Reflect.get(raw, "runID");
  assert.ok(typeof runID === "string" && macUUID.test(runID));
  assert.deepEqual(
    raw,
    readinessReceipt(expected, runID),
    "Capture readiness belongs to another artifact or installed Runner",
  );
}
export async function persistMacVMCaptureReady(
  file: string,
  expected: MacVMCaptureIdentity,
  runID: string,
): Promise<void> {
  assert.match(runID, macUUID);
  try {
    requireMacVMCaptureReady(await readOwnedMacVMJSON(file, 4096), expected);
    return; // Preserve the exact earlier successful setup receipt.
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const temporary = path.join(
    path.dirname(file),
    `.capture-ready-${crypto.randomUUID()}.json`,
  );
  await writeFile(
    temporary,
    JSON.stringify(readinessReceipt(expected, runID)),
    { flag: "wx", mode: 0o600 },
  );
  try {
    await link(temporary, file);
  } finally {
    await unlink(temporary);
  }
}

/** Preserve real absence/retirement evidence when failure precedes the shared journey. */
export async function recordUnstartedMacVM(
  binding: RunBinding,
  evidence: string,
  retire: typeof retireMacRun = retireMacRun,
): Promise<void> {
  const retired = await retire(binding, null, evidence);
  await writeFile(
    path.join(evidence, "ownership-cleanup.json"),
    JSON.stringify({
      schemaVersion: 1,
      ...binding,
      journalPresent: false,
      ...retired,
    }),
    { flag: "wx", mode: 0o600 },
  );
}

export async function requireCurrentMacVMSources(
  artifact: MacArtifact,
  command: MacJourneyCommand,
): Promise<void> {
  const workspace = path.resolve(artifact.packageRoot, "../..");
  requireStableSources(
    artifact.sources,
    await sourceFingerprints(workspace, (argv) =>
      command(argv, true, workspace),
    ),
  );
  assert.equal(
    await command(["git", "rev-parse", "HEAD"], true, workspace),
    artifact.sourceHead,
    "Prepared artifact belongs to another source revision",
  );
}

function preparedReceipt(exported: MacVMExport) {
  return {
    schemaVersion: 1,
    status: "prepared",
    buildID: exported.artifact.runID,
    sourceHead: exported.artifact.sourceHead,
    payloadSHA256: exported.payloadSHA256,
    testsRun: 0,
    nativeTestStarted: false,
  };
}

async function inspectExport(
  root: string,
  buildID: string,
  command: MacJourneyCommand,
): Promise<MacVMExport> {
  assert.match(buildID, macUUID);
  const base = path.join(root, ".build/occurrence-vm");
  const directory = path.join(base, "exports", buildID);
  assert.equal(await realpath(directory), directory);
  const directoryMetadata = await lstat(directory);
  assert.ok(
    directoryMetadata.uid === process.getuid?.() &&
      (directoryMetadata.mode & 0o022) === 0,
  );
  for (const name of [
    "artifact.json",
    "payload.json",
    "guest.js",
    "mac-process-owner.swift",
    "occurrence-launches.schema.json",
  ]) {
    const metadata = await lstat(path.join(directory, name));
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.() &&
        (metadata.mode & 0o022) === 0,
    );
  }
  const artifactFile = path.join(directory, "artifact.json");
  assert.equal(
    await macFileSHA(artifactFile),
    await macFileSHA(path.join(base, "builds", buildID, "artifact.json")),
    "Export differs from its normal build receipt",
  );
  const artifact = readMacArtifact(await readOwnedMacVMJSON(artifactFile));
  await readOwnedMacVMJSON(path.join(base, "builds", buildID, "artifact.json"));
  assert.equal(artifact.runID, buildID);
  assert.equal(artifact.packageRoot, root);
  const bundleSHA256 = await macFileSHA(path.join(directory, "guest.js"));
  const payloadFile = path.join(directory, "payload.json");
  assert.deepEqual(await readOwnedMacVMJSON(payloadFile), {
    schemaVersion: 1,
    artifactSHA256: await macFileSHA(artifactFile),
    guestBundleSHA256: bundleSHA256,
  });
  for (const name of [
    "mac-process-owner.swift",
    "occurrence-launches.schema.json",
  ])
    assert.equal(
      await macFileSHA(path.join(directory, name)),
      artifact.sources[
        `packages/tasknotes-macos/scripts/apple-acceptance/${name}`
      ],
    );
  await verifyMacArtifact(artifact, path.join(directory, "products"), command);
  // Only derived per-run copies may change their test configuration.
  for (const [plan, expected] of Object.entries(artifact.files)) {
    if (!plan.endsWith(".xctestrun")) continue;
    const immutable = path.join(directory, "products", plan);
    const metadata = await lstat(immutable);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.(),
    );
    assert.equal(metadata.mode & 0o7777, expected.mode);
    assert.equal(
      await macFileSHA(immutable),
      expected.sha256,
      "Exported test configuration changed",
    );
  }
  await requireCurrentMacVMSources(artifact, command);
  return {
    artifact,
    directory,
    bundleSHA256,
    payloadSHA256: await macFileSHA(payloadFile),
  };
}

/** Explicit reuse never invokes a producer; every signed input and current source is rechecked. */
export async function loadMacVMExport(
  root: string,
  buildID: string,
  command: MacJourneyCommand,
): Promise<MacVMExport> {
  const exported = await inspectExport(root, buildID, command);
  assert.deepEqual(
    await readOwnedMacVMJSON(
      path.join(root, ".build/occurrence-vm/builds", buildID, "prepared.json"),
      4096,
    ),
    preparedReceipt(exported),
  );
  return exported;
}

/** Build once, then bind the exact bundle and signed products for setup and replay. */
export async function prepareMacVMExport(
  root: string,
  buildID: string,
  command: MacJourneyCommand,
): Promise<MacVMExport> {
  assert.match(buildID, macUUID);
  const evidence = path.join(root, ".build/occurrence-vm/builds", buildID);
  const directory = path.join(root, ".build/occurrence-vm/exports", buildID);
  const artifact = await buildMacArtifact(root, evidence, command);
  await mkdir(path.dirname(directory), { recursive: true });
  assert.equal(
    await realpath(path.dirname(directory)),
    path.dirname(directory),
  );
  await mkdir(directory, { recursive: false });
  await materializeMacArtifact(
    artifact,
    path.join(evidence, "macos/Build/Products"),
    path.join(directory, "products"),
  );
  await copyFile(
    path.join(evidence, "artifact.json"),
    path.join(directory, "artifact.json"),
    1,
  );
  for (const name of [
    "mac-process-owner.swift",
    "occurrence-launches.schema.json",
  ])
    await copyFile(
      path.join(root, "scripts/apple-acceptance", name),
      path.join(directory, name),
      1,
    );
  const bundle = await Bun.build({
    entrypoints: [path.join(root, "scripts/occurrence-acceptance/run-vm.ts")],
    outdir: directory,
    naming: "guest.js",
    target: "bun",
  });
  assert.ok(bundle.success, "Guest bundling failed");
  await Bun.write(
    path.join(directory, "payload.json"),
    JSON.stringify({
      schemaVersion: 1,
      artifactSHA256: await macFileSHA(path.join(directory, "artifact.json")),
      guestBundleSHA256: await macFileSHA(path.join(directory, "guest.js")),
    }),
  );
  const exported = await inspectExport(root, buildID, command);
  await Bun.write(
    path.join(evidence, "prepared.json"),
    JSON.stringify(preparedReceipt(exported), null, 2),
  );
  return exported;
}
