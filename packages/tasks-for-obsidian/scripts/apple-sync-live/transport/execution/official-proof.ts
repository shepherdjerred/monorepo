import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { UuidSchema, SHA256Schema } from "../fields.ts";
import { readOwnedMacVMJSON } from "tasknotes-macos/scripts/apple-acceptance/mac-vm-export.ts";
import { OfficialAccountReceiptSchema } from "./contract.ts";
import type { GuestRuntime } from "./runtime.ts";

function submissionPath(runtime: GuestRuntime) {
  return path.join(
    runtime.paths.evidenceDirectory,
    "official-account/submission-attempt.json",
  );
}
export async function officialSubmissionAttempted(
  runtime: GuestRuntime,
): Promise<boolean> {
  try {
    const value = SubmissionSchema.parse(
      await readOwnedMacVMJSON(submissionPath(runtime), 8192),
    );
    assert.deepEqual(value.identity, identityFor(runtime));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
export async function retainOfficialSubmission(
  runtime: GuestRuntime,
  receipt: z.infer<typeof OfficialAccountReceiptSchema>,
): Promise<void> {
  const { pid, startSeconds, startMicroseconds, launchDate } = receipt;
  const value = SubmissionSchema.parse({
    schemaVersion: 1,
    kind: "official-private-submit-attempt",
    identity: identityFor(runtime),
    pid,
    startSeconds,
    startMicroseconds,
    launchDate,
  });
  await writeFile(submissionPath(runtime), JSON.stringify(value), {
    flag: "wx",
    mode: 0o600,
  });
}

export const OfficialProbeIdentitySchema = z.strictObject({
  runID: UuidSchema,
  guestConfigSHA256: SHA256Schema,
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
  mainSourceSHA256: SHA256Schema,
  ownerSourceSHA256: SHA256Schema,
});
const SubmissionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("official-private-submit-attempt"),
  identity: OfficialProbeIdentitySchema,
  pid: z.number().int().positive(),
  startSeconds: z.number().int().nonnegative(),
  startMicroseconds: z.number().int().min(0).max(999_999),
  launchDate: z.number().positive(),
});

const ProbeSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("official-private-input-probe"),
  identity: OfficialProbeIdentitySchema,
  binarySHA256: SHA256Schema,
  receipt: OfficialAccountReceiptSchema,
});
export function requireOfficialProbe(
  value: unknown,
  identity: z.infer<typeof OfficialProbeIdentitySchema>,
): void {
  const proof = ProbeSchema.parse(value);
  assert.deepEqual(proof.identity, identity);
  assert.equal(proof.receipt.cleared, true);
  assert.equal(proof.receipt.submitActionCount, 0);
  assert.equal(proof.receipt.secureField, true);
  assert.equal(proof.receipt.focusedSecureField, true);
  assert.equal(proof.receipt.loginEnabled, true);
  assert.equal(proof.receipt.emailLength, 32);
  assert.equal(proof.receipt.passwordLength, 38);
}
function identityFor(runtime: GuestRuntime) {
  return OfficialProbeIdentitySchema.parse({
    runID: runtime.config.runID,
    guestConfigSHA256: runtime.expectedConfigSHA,
    sourceHead: runtime.config.sourceHead,
    mainSourceSHA256: runtime.config.helpers["official-account.swift"],
    ownerSourceSHA256: runtime.config.helpers["OfficialOwner.swift"],
  });
}
export function officialProbePath(runtime: GuestRuntime): string {
  return path.join(
    runtime.paths.evidenceDirectory,
    "official-account/probe-ready.json",
  );
}
export async function officialProbeReady(
  runtime: GuestRuntime,
): Promise<boolean> {
  try {
    requireOfficialProbe(
      await readOwnedMacVMJSON(officialProbePath(runtime), 8192),
      identityFor(runtime),
    );
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
export async function retainOfficialProbe(
  runtime: GuestRuntime,
  binarySHA256: string,
  receipt: z.infer<typeof OfficialAccountReceiptSchema>,
): Promise<void> {
  const proof = ProbeSchema.parse({
    schemaVersion: 1,
    kind: "official-private-input-probe",
    identity: identityFor(runtime),
    binarySHA256,
    receipt,
  });
  requireOfficialProbe(proof, identityFor(runtime));
  await writeFile(officialProbePath(runtime), JSON.stringify(proof), {
    flag: "wx",
    mode: 0o600,
  });
  assert.equal(await officialProbeReady(runtime), true);
}
