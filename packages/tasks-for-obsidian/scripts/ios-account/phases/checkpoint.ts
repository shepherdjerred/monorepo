import assert from "node:assert/strict";
import { lstat, readFile, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readExactHandle } from "tasknotes-macos/scripts/apple-acceptance/owned-handle.ts";
import {
  clientState,
  runDirectory,
  digest,
  type Manifest,
} from "../../apple-sync-live/model";
import { writeExclusiveMetadata } from "./intents";
import { inputBundle } from "../app-input-artifacts";

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
export const AuthCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("ios-account-auth-only-checkpoint"),
  runID: z.uuid(),
  sourceHead: z.string().regex(/^[a-f0-9]{40}$/u),
  remoteVaultID: z.string().min(1).max(256),
  ownerBindingSHA256: sha,
  metadataSHA256: sha,
  profileCount: z.number().int().min(0).max(1),
  authEntryID: z.uuid(),
  authSessionID: z.uuid(),
  authOutcomeSHA256: sha,
  authEvidenceSHA256: sha,
  sourceFilesSHA256: sha,
  appFilesSHA256: sha,
  runnerFilesSHA256: sha,
  inputArtifactsSHA256: sha,
  phaseProofs: z.strictObject({ credentials: sha, verification: sha }),
});
export type AuthCheckpoint = z.infer<typeof AuthCheckpointSchema>;
const AuthoritySchema = AuthCheckpointSchema.pick({
  runID: true,
  sourceHead: true,
  remoteVaultID: true,
  ownerBindingSHA256: true,
  metadataSHA256: true,
  profileCount: true,
  sourceFilesSHA256: true,
  appFilesSHA256: true,
  runnerFilesSHA256: true,
  inputArtifactsSHA256: true,
  phaseProofs: true,
});
export function assertAuthCheckpointAuthority(
  checkpoint: AuthCheckpoint,
  expected: z.infer<typeof AuthoritySchema>,
) {
  assert.deepEqual(
    AuthoritySchema.strip().parse(AuthCheckpointSchema.parse(checkpoint)),
    AuthoritySchema.parse(expected),
    "Authenticated account checkpoint no longer owns this phase",
  );
}
export function mapDigest(value: Record<string, string>) {
  return digest(
    Buffer.from(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    ),
  );
}
export function phaseFile(
  manifest: Manifest,
  kind: string,
  lifecycleRound = 0,
) {
  return path.join(
    runDirectory(manifest.runID),
    "ios-account",
    kind + "-" + String(lifecycleRound) + ".json",
  );
}
export async function reservePhase(
  manifest: Manifest,
  operation: "auth-only" | "connect-only",
  lifecycleRound?: number,
) {
  await writeExclusiveMetadata(
    phaseFile(manifest, operation + "-attempt", lifecycleRound),
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        runID: manifest.runID,
        operation,
        attemptID: crypto.randomUUID(),
      }) + "\n",
    ),
  );
}
export async function accountOwnerSnapshot(manifest: Manifest) {
  const file = path.join(
    clientState(manifest, "ios").stateDirectory,
    "accounts/sync-identities.json",
  );
  const bytes = await readPrivatePhaseBytes(file);
  const metadata = z
    .strictObject({
      schemaVersion: z.literal(1),
      activeOwner: sha,
      identities: z.record(z.string(), z.unknown()),
      pendingKeyRemoval: z.array(z.string()).optional(),
    })
    .parse(JSON.parse(bytes.toString("utf8")));
  return {
    ownerBindingSHA256: digest(Buffer.from(metadata.activeOwner)),
    metadataSHA256: digest(bytes),
    profileCount: Object.keys(metadata.identities).length,
  };
}
export async function readPrivatePhaseBytes(file: string) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(
      before.isFile() &&
        before.uid === process.getuid?.() &&
        (before.mode & 0o777) === 0o600 &&
        (await realpath(file)) === file &&
        before.size > 0 &&
        before.size <= 4 * 1024 * 1024,
    );
    const bytes = Buffer.from(
      await readExactHandle(handle, before.size, 4 * 1024 * 1024),
    );
    const after = await handle.stat(),
      current = await lstat(file);
    assert.ok(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.mtimeMs === after.mtimeMs &&
        before.size === bytes.length &&
        current.dev === before.dev &&
        current.ino === before.ino &&
        current.mtimeMs === before.mtimeMs &&
        current.mode === before.mode &&
        current.uid === before.uid,
    );
    return bytes;
  } finally {
    await handle.close();
  }
}
/** A corrupt or dangling checkpoint is existing authority to reject, never a reason to sign in again. */
export async function hasCheckpointFile(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}
export async function proofDigests(manifest: Manifest) {
  const root = path.join(runDirectory(manifest.runID), "ios-account");
  return {
    credentials: digest(
      await readFile(path.join(root, "credentials-private-input-ready.json")),
    ),
    verification: digest(
      await readFile(path.join(root, "verification-private-input-ready.json")),
    ),
  };
}
export async function saveAuthCheckpoint(
  manifest: Manifest,
  value: AuthCheckpoint,
  lifecycleRound?: number,
) {
  const checked = AuthCheckpointSchema.parse(value);
  await writeExclusiveMetadata(
    phaseFile(manifest, "auth-checkpoint", lifecycleRound),
    Buffer.from(JSON.stringify(checked) + "\n"),
  );
}
export async function readAuthCheckpoint(
  manifest: Manifest,
  lifecycleRound?: number,
) {
  const checkpointBytes = await readPrivatePhaseBytes(
    phaseFile(manifest, "auth-checkpoint", lifecycleRound),
  );
  const checked = AuthCheckpointSchema.parse(
    JSON.parse(checkpointBytes.toString("utf8")),
  );
  assert.equal(checked.runID, manifest.runID);
  assert.equal(checked.remoteVaultID, manifest.allowedRemoteVaultID);
  const outcomeFile = path.join(
    runDirectory(manifest.runID),
    "ios-account/entries",
    checked.authEntryID,
    "outcome.json",
  );
  const bytes = await readPrivatePhaseBytes(outcomeFile);
  assert.equal(digest(bytes), checked.authOutcomeSHA256);
  z.object({
    operation: z.literal("auth-only"),
    status: z.literal("passed"),
    native: z.literal("fulfilled"),
    input: z.literal("fulfilled"),
    cleanup: z.literal("closed"),
  }).parse(JSON.parse(bytes.toString("utf8")));
  assert.equal(
    mapDigest(await inputBundle(path.dirname(outcomeFile))),
    checked.authEvidenceSHA256,
  );
  return checked;
}
