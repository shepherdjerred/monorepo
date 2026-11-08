import assert from "node:assert/strict";
import { lstat, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { GuestBindingSchema, SHA256Schema, UuidSchema } from "../fields.ts";
import type { GuestRequest } from "../contract.ts";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { AccountCheckpointSchema } from "./contract.ts";
import type { GuestRuntime } from "./runtime.ts";

const DescriptorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runID: UuidSchema,
  stateDirectory: z.string(),
  allowedRemoteVaultID: z.string().min(1).max(256).nullable(),
});
export const StoredCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("tart-guest-account-checkpoint"),
  binding: GuestBindingSchema,
  checkpoint: AccountCheckpointSchema,
  guestConfigSHA256: SHA256Schema,
});
export type StoredCheckpoint = z.infer<typeof StoredCheckpointSchema>;
export async function writeGuestJSON(
  file: string,
  value: unknown,
): Promise<void> {
  try {
    const metadata = await lstat(file);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        metadata.uid === process.getuid?.(),
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  const temporary = path.join(
    path.dirname(file),
    `.live-${crypto.randomUUID()}.json`,
  );
  await writeFile(temporary, JSON.stringify(value), {
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, file);
}
export function requireCheckpointTransition(
  previous: StoredCheckpoint | null,
  next: StoredCheckpoint,
): void {
  const rounds = next.checkpoint.completedRounds;
  assert.ok(rounds.length <= next.binding.round);
  rounds.forEach((entry, index) => {
    assert.equal(entry.round, index + 1);
  });
  if (previous === null) {
    assert.equal(next.binding.round, 1);
    assert.equal(rounds.length, 0);
    return;
  }
  assert.equal(next.binding.runID, previous.binding.runID);
  assert.equal(next.guestConfigSHA256, previous.guestConfigSHA256);
  assert.equal(next.checkpoint.scope, previous.checkpoint.scope);
  assert.ok(
    next.binding.round >= previous.binding.round &&
      next.binding.round <= previous.binding.round + 1,
  );
  assert.ok(
    next.checkpoint.failuresCount >= previous.checkpoint.failuresCount,
    "Failure history cannot reset",
  );
  if (previous.checkpoint.stage === "failed")
    assert.equal(next.checkpoint.stage, "failed");
  if (previous.checkpoint.stage === "cleaned")
    assert.equal(next.checkpoint.stage, "cleaned");
  if (previous.binding.allowedRemoteVaultID !== null)
    assert.equal(
      next.binding.allowedRemoteVaultID,
      previous.binding.allowedRemoteVaultID,
    );
  assert.ok(rounds.length >= previous.checkpoint.completedRounds.length);
  assert.deepEqual(
    rounds.slice(0, previous.checkpoint.completedRounds.length),
    previous.checkpoint.completedRounds,
  );
  if (next.binding.round !== previous.binding.round) {
    assert.equal(previous.checkpoint.failuresCount, 0);
    assert.equal(next.checkpoint.failuresCount, 0);
    assert.equal(rounds.length, previous.binding.round);
    assert.equal(next.checkpoint.stage, "bound");
  }
}
export async function readCheckpoint(
  runtime: GuestRuntime,
): Promise<StoredCheckpoint | null> {
  try {
    const checkpoint = StoredCheckpointSchema.parse(
      await readOwnedMacVMJSON(
        path.join(runtime.paths.evidenceDirectory, "account-checkpoint.json"),
        65_536,
      ),
    );
    assert.equal(checkpoint.guestConfigSHA256, runtime.expectedConfigSHA);
    assert.equal(checkpoint.binding.runID, runtime.config.runID);
    assert.equal(checkpoint.checkpoint.scope, runtime.config.scope);
    return checkpoint;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
export async function currentGuestBinding(
  runtime: GuestRuntime,
  request: GuestRequest,
) {
  const descriptor = DescriptorSchema.parse(
    await readOwnedMacVMJSON(runtime.paths.descriptor, 4096),
  );
  assert.equal(descriptor.runID, runtime.config.runID);
  assert.equal(descriptor.stateDirectory, runtime.paths.stateDirectory);
  const grant = DescriptorSchema.parse(
    await readOwnedMacVMJSON(
      path.join(runtime.paths.evidenceDirectory, "vault-grant.json"),
      4096,
    ),
  );
  assert.deepEqual(
    grant,
    descriptor,
    "Incomplete vault transition must be inspected before retry",
  );
  const checkpoint = await readCheckpoint(runtime);
  let round = checkpoint?.binding.round ?? 1;
  if (request.operation.kind === "checkpoint") {
    const next = StoredCheckpointSchema.parse({
      schemaVersion: 1,
      kind: "tart-guest-account-checkpoint",
      binding: request.binding,
      checkpoint: request.operation.checkpoint,
      guestConfigSHA256: runtime.expectedConfigSHA,
    });
    assert.equal(
      next.binding.allowedRemoteVaultID,
      descriptor.allowedRemoteVaultID,
    );
    requireCheckpointTransition(checkpoint, next);
    round = next.binding.round;
  }
  return {
    runID: runtime.config.runID,
    allowedRemoteVaultID: descriptor.allowedRemoteVaultID,
    round,
  };
}
export async function authorizeGuestExecution(
  runtime: GuestRuntime,
  request: GuestRequest,
): Promise<void> {
  if (request.operation.kind === "checkpoint") return;
  const checkpoint = await readCheckpoint(runtime);
  assert.ok(checkpoint !== null);
  const readonly = [
    "verify",
    "status",
    "snapshot",
    "fileInfo",
    "readFileChunk",
    "outbox",
    "interruption",
    "official-info",
    "retire",
  ].includes(request.operation.kind);
  if (readonly) return;
  assert.equal(checkpoint.checkpoint.failuresCount, 0);
  assert.ok(!["failed", "cleaned"].includes(checkpoint.checkpoint.stage));
  if (
    request.operation.kind === "official-launch" ||
    request.operation.kind === "official-account" ||
    request.operation.kind === "official-verification-prepare" ||
    request.operation.kind === "official-plugin"
  ) {
    assert.ok(
      ["preparing", "owner-setup"].includes(checkpoint.checkpoint.stage),
    );
    return;
  }
  if (request.operation.kind === "descriptor") {
    if (request.operation.vaultID === null) {
      assert.equal(request.binding.allowedRemoteVaultID, null);
      assert.ok(
        ["preparing", "owner-setup"].includes(checkpoint.checkpoint.stage),
      );
      return;
    }
    assert.equal(checkpoint.checkpoint.stage, "owner-setup");
    assert.equal(checkpoint.checkpoint.officialReferencePassed, true);
    return;
  }
  assert.equal(checkpoint.checkpoint.officialReferencePassed, true);
  if (request.operation.kind === "launch" && request.operation.discovery) {
    assert.equal(checkpoint.checkpoint.stage, "owner-setup");
    return;
  }
  assert.ok(request.binding.allowedRemoteVaultID !== null);
  assert.ok(
    ["bound", "initial-verified"].includes(checkpoint.checkpoint.stage),
  );
  if (
    request.operation.kind.startsWith("official-") &&
    request.operation.kind !== "official-info"
  )
    assert.equal(checkpoint.checkpoint.initialDownloadPassed, true);
}
export async function bindGuestVault(
  runtime: GuestRuntime,
  vaultID: string | null,
): Promise<void> {
  const current = DescriptorSchema.parse(
    await readOwnedMacVMJSON(runtime.paths.descriptor, 4096),
  );
  requireVaultTransition(current.allowedRemoteVaultID, vaultID);
  const next = { ...current, allowedRemoteVaultID: vaultID };
  await writeGuestJSON(
    path.join(runtime.paths.evidenceDirectory, "vault-grant.json"),
    next,
  );
  await writeGuestJSON(runtime.paths.descriptor, next);
}
export function requireVaultTransition(
  current: string | null,
  next: string | null,
): void {
  if (current !== null)
    assert.equal(next, current, "A bound vault cannot reset or change");
}
