import assert from "node:assert/strict";
import { lstat, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  clientState,
  digest,
  runDirectory,
  uuid,
  verifyReplica,
  type Client,
  type Manifest,
} from "../model";
import {
  guestReadFiles,
  guestReferenceApply,
  guestSnapshot,
} from "../transport/client";
import { RelativePathSchema } from "../transport/fields";

export type VaultTarget = "official" | { client: Client; profileID: string };

export function localVault(manifest: Manifest, target: VaultTarget): string {
  if (
    manifest.schemaVersion === 3 &&
    (target === "official" || target.client === "macos")
  )
    throw new Error("Guest vault addresses cannot be dereferenced on the host");
  if (target === "official")
    return path.join(runDirectory(manifest.runID), "reference-vault");
  uuid.parse(target.profileID);
  return path.join(
    clientState(manifest, target.client).stateDirectory,
    "replicas",
    target.profileID,
  );
}

function guestTarget(target: VaultTarget) {
  return target === "official" ? target : { profileID: target.profileID };
}

function remote(target: VaultTarget): boolean {
  return target === "official" || target.client === "macos";
}

export function safeVaultPath(relative: string): string {
  return RelativePathSchema.parse(relative);
}

export async function readVaultFiles(
  manifest: Manifest,
  target: VaultTarget,
  relatives: string[],
) {
  assert.ok(
    relatives.length > 0 &&
      relatives.length <= 128 &&
      new Set(relatives).size === relatives.length,
  );
  relatives.forEach((relative) => safeVaultPath(relative));
  if (manifest.schemaVersion === 3 && remote(target))
    return guestReadFiles(manifest, guestTarget(target), relatives);
  const directory = localVault(manifest, target);
  const result: Record<string, Uint8Array> = {};
  for (const relative of relatives) {
    const filename = path.join(directory, relative);
    const metadata = await lstat(filename);
    assert.ok(
      metadata.isFile() &&
        !metadata.isSymbolicLink() &&
        (await realpath(filename)) === filename,
    );
    assert.ok(metadata.size <= 20 * 1024 * 1024);
    result[relative] = await readFile(filename);
  }
  return result;
}

export async function readVaultFile(
  manifest: Manifest,
  target: VaultTarget,
  relative: string,
) {
  const files = await readVaultFiles(manifest, target, [relative]);
  const bytes = files[relative];
  assert.ok(bytes !== undefined, "Endpoint omitted the requested vault file");
  return Buffer.from(bytes);
}

export async function vaultSnapshot(manifest: Manifest, target: VaultTarget) {
  if (manifest.schemaVersion === 3 && remote(target))
    return guestSnapshot(manifest, guestTarget(target));
  const directory = localVault(manifest, target);
  const result: Manifest["reference"] = {};
  for (const relative of [
    ...new Bun.Glob("**/*").scanSync({
      cwd: directory,
      onlyFiles: true,
      dot: true,
    }),
  ].sort()) {
    if (
      relative !== ".obsidian/plugins/tasknotes/data.json" &&
      relative.startsWith(".obsidian/")
    )
      continue;
    const bytes = await readVaultFile(manifest, target, relative);
    result[relative] = { size: bytes.length, sha256: digest(bytes) };
  }
  return result;
}

export async function verifyVaultEndpoint(
  manifest: Manifest,
  target: VaultTarget,
  expected: Manifest["reference"],
) {
  if (manifest.schemaVersion === 3 && remote(target)) {
    const actual = await vaultSnapshot(manifest, target);
    assert.deepEqual(
      actual,
      expected,
      "Guest replica has missing, unexpected or changed vault files",
    );
  } else await verifyReplica(localVault(manifest, target), expected);
}

export async function changeReference(
  manifest: Manifest,
  relative: string,
  bytes: Uint8Array | null,
) {
  safeVaultPath(relative);
  const expectedSHA256 = manifest.reference[relative]?.sha256 ?? null;
  if (manifest.schemaVersion === 3)
    return guestReferenceApply(manifest, {
      kind: bytes === null ? "delete" : "write",
      path: relative,
      expectedSHA256,
      ...(bytes === null ? {} : { bytes }),
    });
  const filename = path.join(localVault(manifest, "official"), relative);
  if (expectedSHA256 === null)
    assert.equal(
      await Bun.file(filename).exists(),
      false,
      "Reference create cannot overwrite unknown bytes",
    );
  else
    assert.equal(
      digest(await readVaultFile(manifest, "official", relative)),
      expectedSHA256,
    );
  if (bytes === null) await unlink(filename);
  else await Bun.write(filename, bytes);
}

export async function renameReference(
  manifest: Manifest,
  relative: string,
  destination: string,
) {
  safeVaultPath(relative);
  safeVaultPath(destination);
  const expectedSHA256 = manifest.reference[relative]?.sha256;
  assert.ok(
    expectedSHA256 !== undefined,
    "Reference rename has no known source",
  );
  if (manifest.schemaVersion === 3)
    return guestReferenceApply(manifest, {
      kind: "rename",
      path: relative,
      destination,
      expectedSHA256,
    });
  const directory = localVault(manifest, "official");
  assert.equal(
    digest(await readVaultFile(manifest, "official", relative)),
    expectedSHA256,
  );
  assert.equal(
    await Bun.file(path.join(directory, destination)).exists(),
    false,
  );
  await rename(
    path.join(directory, relative),
    path.join(directory, destination),
  );
}
