import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { GuestRequest } from "../contract.ts";
import {
  decodeBlob,
  FileFingerprintSchema,
  RelativePathSchema,
  SHA256Schema,
  UuidSchema,
} from "../fields.ts";
import {
  ClosedAccountReceiptSchema,
  type ExecutionOperation,
  type ExecutionResult,
} from "./contract.ts";
import type { GuestRuntime } from "./runtime.ts";
import { inspectOwnedMacProcesses } from "../../mac-process-inspection.ts";
import { executePrivateTransport } from "../host.ts";
import { fingerprintOutbox } from "../../outbox.ts";
import { verifyReplica } from "../../model.ts";
import { macFileSHA } from "tasknotes-macos/scripts/apple-acceptance/mac-artifact.ts";
import { readCheckpoint } from "./state.ts";
import { prepareGuestMacInput } from "./account-input/prepare";
import {
  collectGuestMacInput,
  installGuestMacInputApproval,
} from "./account-input/collect";

const LifecyclePacketSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runID: UuidSchema,
  round: z.number().int().min(1).max(3),
  profileID: UuidSchema,
  pendingCount: z.number().int().positive(),
  outbox: z.strictObject({
    count: z.number().int().positive(),
    sha256: SHA256Schema,
  }),
  title: z.string(),
  expected: z.record(RelativePathSchema, FileFingerprintSchema),
});
/** The exact addressed native helper receives secrets only through its private stdin. */
export async function runGuestAccount(
  runtime: GuestRuntime,
  operation: Extract<ExecutionOperation, { kind: "account" }>,
  request: GuestRequest,
): Promise<ExecutionResult> {
  assert.ok(request.binding.allowedRemoteVaultID !== null);
  const checkpoint = await readCheckpoint(runtime);
  assert.ok(checkpoint !== null);
  let lifecycle: {
    round: number;
    profileID: string;
    pendingCount: number;
    outboxSHA256: string;
    checkpointSHA256: string;
  } | null = null;
  let lifecyclePacket: z.infer<typeof LifecyclePacketSchema> | null = null;
  if (operation.lifecycleRound === undefined) {
    assert.equal(operation.lifecycleCheckpoint, undefined);
    assert.equal(checkpoint.checkpoint.stage, "bound");
  } else {
    assert.equal(operation.lifecycleRound, request.binding.round);
    assert.ok(operation.lifecycleCheckpoint !== undefined);
    assert.equal(checkpoint.checkpoint.stage, "initial-verified");
    assert.equal(checkpoint.checkpoint.initialDownloadPassed, true);
    assert.equal(checkpoint.checkpoint.lifecycleBeginPassed, true);
    assert.equal(checkpoint.checkpoint.lifecycleFinishPresent, false);
    const bytes = decodeBlob(operation.lifecycleCheckpoint);
    assert.ok(bytes.length <= 65_536);
    const packet = LifecyclePacketSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    assert.equal(packet.runID, runtime.config.runID);
    assert.equal(packet.round, operation.lifecycleRound);
    assert.equal(packet.outbox.count, packet.pendingCount);
    lifecyclePacket = packet;
    const file = path.join(
      runtime.paths.evidenceDirectory,
      "lifecycle-macos-checkpoint.json",
    );
    if (await Bun.file(file).exists())
      assert.equal(
        await macFileSHA(file),
        operation.lifecycleCheckpoint.sha256,
      );
    else await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    lifecycle = {
      round: packet.round,
      profileID: packet.profileID,
      pendingCount: packet.pendingCount,
      outboxSHA256: packet.outbox.sha256,
      checkpointSHA256: operation.lifecycleCheckpoint.sha256,
    };
  }
  await verifyPending();
  if (operation.action.mode === "input_prepare") {
    return {
      kind: "account",
      receipt: await prepareGuestMacInput(
        runtime,
        operation.action.operation,
        operation.action.sessionID,
        { remoteID: request.binding.allowedRemoteVaultID, lifecycle },
      ),
    };
  }
  if (operation.action.mode === "input_collect") {
    return {
      kind: "account",
      receipt: await collectGuestMacInput(runtime, operation.action.sessionID),
    };
  }
  if (operation.action.mode === "input_approve") {
    return {
      kind: "account",
      receipt: await installGuestMacInputApproval(
        runtime,
        new TextEncoder().encode(JSON.stringify(operation.action.approval)),
      ),
    };
  }
  const directory = path.join(
    runtime.paths.evidenceDirectory,
    `account-helper-${request.requestID}`,
  );
  await mkdir(directory, { mode: 0o700 });
  const sources: string[] = [];
  for (const name of [
    "account-main.swift",
    "AccountRuntime.swift",
    "AccountOwner.swift",
    "AccountLifecycle.swift",
    "MacAccountProtocol.swift",
    "MacAccountIO.swift",
    "MacAccountSession.swift",
  ] as const) {
    const destination = path.join(
      directory,
      name === "account-main.swift" ? "main.swift" : name,
    );
    await copyFile(
      path.join(runtime.exportRoot, "live-helpers", name),
      destination,
      1,
    );
    assert.equal(await macFileSHA(destination), runtime.config.helpers[name]);
    sources.push(destination);
  }
  const helper = path.join(directory, "mac-account-input");
  await runtime.command(["/usr/bin/xcrun", "swiftc", ...sources, "-o", helper]);
  await chmod(helper, 0o700);
  const binarySHA = await macFileSHA(helper);
  const executable = path.join(
      runtime.paths.app,
      "Contents/MacOS/FacetAcceptance",
    ),
    owners = await inspectOwnedMacProcesses(executable, 5000);
  assert.equal(owners.length, 1);
  const pid = Number(owners[0]);
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const lifetime =
    "lifetime" in operation.action ? operation.action.lifetime : {};
  const action = Object.fromEntries(
    Object.entries(operation.action).filter(([key]) => key !== "lifetime"),
  );
  const input = {
    runID: runtime.config.runID,
    remoteID: request.binding.allowedRemoteVaultID,
    runDirectory: runtime.paths.evidenceDirectory,
    executable,
    container: runtime.paths.container,
    stateDirectory: runtime.paths.stateDirectory,
    lifecycle,
    guestConfigSHA256: runtime.expectedConfigSHA,
    pid,
    ...action,
    ...lifetime,
  };
  assert.equal(await macFileSHA(helper), binarySHA);
  async function verifyPending() {
    if (lifecyclePacket === null) return;
    await verifyReplica(
      path.join(
        runtime.paths.stateDirectory,
        "replicas",
        lifecyclePacket.profileID,
      ),
      lifecyclePacket.expected,
    );
    const file = path.join(runtime.paths.stateDirectory, "facet.sqlite3"),
      metadata = await lstat(file);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.(),
    );
    assert.equal(await realpath(file), file);
    const database = new Database(file, { readonly: true, create: false });
    try {
      assert.deepEqual(
        fingerprintOutbox(database, lifecyclePacket.profileID),
        lifecyclePacket.outbox,
      );
    } finally {
      database.close();
    }
  }
  await verifyPending();
  const result = await executePrivateTransport(
    [helper],
    new TextEncoder().encode(JSON.stringify(input)),
    60_000,
  );
  assert.ok(result.stdout.length <= 8192);
  assert.equal(result.stderr.length, 0);
  let raw: unknown;
  try {
    raw = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(result.stdout),
    );
  } catch {
    throw new Error(
      "Native account helper returned an invalid closed receipt; submission outcome unknown",
    );
  }
  const receipt = ClosedAccountReceiptSchema.parse(raw);
  assert.equal(result.exitCode, receipt.blocked === undefined ? 0 : 3);
  assert.equal(
    receipt.blocked,
    undefined,
    "Guest native account guard rejected the operation",
  );
  assert.equal(await macFileSHA(helper), binarySHA);
  await verifyPending();
  return { kind: "account", receipt };
}
