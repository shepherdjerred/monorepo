import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  boundaryCheck,
  type AccountCommand,
  type AccountIdentity,
} from "../contract";
import type { AccountOperation } from "../contract";

const base = {
  schemaVersion: z.literal(1),
  runID: z.uuid(),
  sessionID: z.uuid(),
  deviceID: z.uuid(),
  requestID: z.uuid(),
};
export const SubmitIntentSchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...base,
    operation: z.enum(["auth-only", "fixture-verification"]),
    action: z.literal("credentials"),
    remoteVaultID: z.null(),
    profileID: z.null(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("auth-only"),
    action: z.literal("verification"),
    remoteVaultID: z.null(),
    profileID: z.null(),
  }),
  z.strictObject({
    ...base,
    operation: z.literal("connect-only"),
    action: z.literal("connect"),
    remoteVaultID: z.string().min(1).max(256),
    profileID: z.uuid().nullable(),
  }),
]);
export type SubmitIntent = z.infer<typeof SubmitIntentSchema>;
export function submissionIntent(
  operation: AccountOperation,
  command: AccountCommand,
) {
  const action =
    command.kind === "submit"
      ? "credentials"
      : command.kind === "submit-verification"
        ? "verification"
        : command.kind === "connect"
          ? "connect"
          : undefined;
  if (action === undefined) return;
  const intent = {
    schemaVersion: 1,
    runID: command.runID,
    sessionID: command.sessionID,
    deviceID: command.deviceID,
    requestID: command.requestID,
    operation,
    action,
    remoteVaultID: command.kind === "connect" ? command.remoteVaultID : null,
    profileID: command.kind === "connect" ? (command.profileID ?? null) : null,
  };
  boundaryCheck("submit-intent", intent);
  return SubmitIntentSchema.parse(intent);
}
async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const value = await lstat(directory);
  assert.ok(
    value.isDirectory() &&
      !value.isSymbolicLink() &&
      value.uid === process.getuid?.() &&
      (value.mode & 0o777) === 0o700 &&
      (await realpath(directory)) === directory,
  );
}
export async function writeExclusiveMetadata(file: string, bytes: Uint8Array) {
  const directory = path.dirname(file);
  await privateDirectory(directory);
  const handle = await open(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  );
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const parent = await open(directory, constants.O_RDONLY);
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
export async function recordHostIntent(evidence: string, intent: SubmitIntent) {
  boundaryCheck("submit-intent", intent);
  await writeExclusiveMetadata(
    path.join(evidence, "intents/host", intent.action + ".json"),
    Buffer.from(JSON.stringify(intent) + "\n"),
  );
}
async function ownedBytes(file: string) {
  const before = await lstat(file);
  assert.ok(
    before.isFile() &&
      !before.isSymbolicLink() &&
      before.uid === process.getuid?.() &&
      (before.mode & 0o777) === 0o600 &&
      before.size <= 8192 &&
      (await realpath(file)) === file,
  );
  const bytes = await readFile(file),
    after = await lstat(file);
  assert.ok(
    before.dev === after.dev &&
      before.ino === after.ino &&
      before.mtimeMs === after.mtimeMs &&
      before.size === bytes.length,
  );
  return bytes;
}
export async function retainNativeIntents(
  socketDirectory: string | undefined,
  evidence: string,
  identity: AccountIdentity,
) {
  const hostDirectory = path.join(evidence, "intents/host");
  let hostNames: string[] = [];
  try {
    const names = await readdir(hostDirectory);
    hostNames = names.sort();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  for (const name of hostNames)
    assert.ok(
      ["credentials.json", "verification.json", "connect.json"].includes(name),
    );
  if (socketDirectory === undefined)
    return { available: false, actions: [], missingNative: hostNames };
  const directory = path.join(
    path.dirname(path.dirname(socketDirectory)),
    "FacetAccountIntents",
    identity.sessionID,
  );
  let metadata;
  try {
    metadata = await lstat(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { available: true, actions: [], missingNative: hostNames };
    throw error;
  }
  assert.ok(
    metadata.isDirectory() &&
      !metadata.isSymbolicLink() &&
      metadata.uid === process.getuid?.() &&
      (metadata.mode & 0o777) === 0o700 &&
      (await realpath(directory)) === directory,
  );
  const actions: SubmitIntent["action"][] = [];
  const nativeNames = await readdir(directory);
  for (const name of nativeNames.sort()) {
    assert.ok(
      ["credentials.json", "verification.json", "connect.json"].includes(name),
    );
    const bytes = await ownedBytes(path.join(directory, name));
    const raw: unknown = JSON.parse(bytes.toString("utf8"));
    boundaryCheck("submit-intent", raw);
    const intent = SubmitIntentSchema.parse(raw);
    assert.equal(name, intent.action + ".json");
    for (const field of ["runID", "sessionID", "deviceID"] as const)
      assert.equal(intent[field], identity[field]);
    const hostBytes = await ownedBytes(
      path.join(evidence, "intents/host", name),
    );
    const host: unknown = JSON.parse(hostBytes.toString("utf8"));
    assert.deepEqual(
      intent,
      SubmitIntentSchema.parse(host),
      "Native intent differs from its host authority",
    );
    // Preserve the original native bytes; JSON formatting is not an evidence transformation.
    await writeExclusiveMetadata(
      path.join(evidence, "intents/native", name),
      bytes,
    );
    actions.push(intent.action);
  }
  return {
    available: true,
    actions,
    missingNative: hostNames.filter(
      (name) => !actions.some((action) => name === action + ".json"),
    ),
  };
}
