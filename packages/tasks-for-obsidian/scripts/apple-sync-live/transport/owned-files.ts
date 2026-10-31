import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { DataOperationSchema } from "./contract.ts";
import { readExactHandle } from "tasknotes-macos/scripts/apple-acceptance/owned-handle.ts";
import {
  contentSHA,
  encodeBlob,
  decodeBlob,
  maximumFileBytes,
  maximumFiles,
  maximumTotalBytes,
  RelativePathSchema,
  UuidSchema,
  type FileFingerprint,
} from "./fields.ts";

const settings = ".obsidian/plugins/tasknotes/data.json";
const pluginReads = new Set([
  settings,
  ".obsidian/community-plugins.json",
  ".obsidian/plugins/tasknotes/manifest.json",
  ".obsidian/plugins/tasknotes/main.js",
  ".obsidian/plugins/tasknotes/styles.css",
]);
const accountSessionEvidence = new Set([
  "prepared.json",
  "app.stdout",
  "app.stderr",
  "fd-before.stdout",
  "fd-before.stderr",
  "fd-before.json",
  "fd-after.stdout",
  "fd-after.stderr",
  "fd-after.json",
  "unified.stdout",
  "unified.stderr",
  "unified.json",
  "capture.json",
  "native-intent.json",
]);
export type GuestPaths = {
  stateDirectory: string;
  referenceDirectory: string;
  evidenceDirectory: string;
};
type Change = Extract<
  z.infer<typeof DataOperationSchema>,
  { kind: "referenceApply" }
>["change"];

export async function ownedDirectory(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  assert.ok(metadata.isDirectory() && !metadata.isSymbolicLink());
  assert.equal(metadata.uid, process.getuid?.());
  assert.equal(await realpath(directory), directory);
}

export async function ownedPath(
  root: string,
  relative: string,
  createParents = false,
): Promise<string> {
  RelativePathSchema.parse(relative);
  await ownedDirectory(root);
  let parent = root;
  for (const segment of relative.split("/").slice(0, -1)) {
    parent = path.join(parent, segment);
    if (createParents) {
      try {
        await mkdir(parent, { mode: 0o700 });
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
    }
    await ownedDirectory(parent);
  }
  return path.join(root, relative);
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/** The immutable bytes are measured from one no-follow file handle, never a live database copy. */
export async function readOwnedBytes(
  root: string,
  relative: string,
): Promise<Uint8Array> {
  return readMeasuredBytes(root, relative, false);
}

/** Status/result publishers atomically replace their pathname; an intact owned FD is a snapshot. */
export async function readOwnedPublication(
  root: string,
  relative: "control/status.json" | "control/result.json",
): Promise<Uint8Array> {
  assert.ok(["control/status.json", "control/result.json"].includes(relative));
  return readMeasuredBytes(root, relative, true);
}

async function readMeasuredBytes(
  root: string,
  relative: string,
  publication: boolean,
): Promise<Uint8Array> {
  const file = await ownedPath(root, relative),
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    assert.ok(
      before.isFile() &&
        before.uid === process.getuid?.() &&
        before.size <= maximumFileBytes,
    );
    const bytes = await readExactHandle(handle, before.size, maximumFileBytes);
    const after = await handle.stat();
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.uid, before.uid);
    const actual = await lstat(file);
    assert.ok(
      actual.isFile() && !actual.isSymbolicLink() && actual.uid === before.uid,
    );
    const replaced = actual.dev !== before.dev || actual.ino !== before.ino;
    if (publication && replaced) {
      // Unlinking the old publication can change ctime, but cannot change its measured bytes.
      assert.ok(after.nlink === 0 || after.nlink < before.nlink);
    } else {
      assert.equal(after.ctimeMs, before.ctimeMs);
      assert.equal(actual.dev, before.dev);
      assert.equal(actual.ino, before.ino);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

export function evidencePathAllowed(relative: string): boolean {
  const segments = relative.split("/");
  const [root, sessions, sessionID, filename] = segments;
  const accountSession =
    root === "account-input" &&
    sessions === "sessions" &&
    segments.length === 4 &&
    filename !== undefined &&
    accountSessionEvidence.has(filename) &&
    sessionID?.toLowerCase() === sessionID &&
    UuidSchema.safeParse(sessionID).success;
  return (
    accountSession ||
    /^journeys\/round-[123]\/[A-Za-z0-9][A-Za-z0-9-]{0,100}\/(?:summary\.json|tests\.json|selected-test\.json|ownership-cleanup\.json|attachments\/(?:manifest\.json|[A-Fa-f0-9-]{36}\.(?:png|json)))$/u.test(
      relative,
    ) ||
    /^official-ui\/round-[123]\/(?:create|edit|complete|uncomplete)\.png$/u.test(
      relative,
    )
  );
}
function readable(relative: string, evidence: boolean): boolean {
  return evidence
    ? evidencePathAllowed(relative)
    : !relative.startsWith(".obsidian/") || pluginReads.has(relative);
}

export async function readFiles(
  root: string,
  paths: string[],
  evidence = false,
) {
  const files: Record<string, ReturnType<typeof encodeBlob>> = {};
  let total = 0;
  assert.ok(
    paths.length <= maximumFiles && new Set(paths).size === paths.length,
  );
  for (const relative of paths) {
    assert.ok(
      readable(relative, evidence),
      "File is outside the closed guest export scope",
    );
    const bytes = await readOwnedBytes(root, relative);
    total += bytes.length;
    assert.ok(total <= maximumTotalBytes);
    files[relative] = encodeBlob(bytes);
  }
  return files;
}

export async function readScopedBytes(
  root: string,
  relative: string,
  evidence = false,
): Promise<Uint8Array> {
  assert.ok(
    readable(relative, evidence),
    "File is outside the closed guest export scope",
  );
  return readOwnedBytes(root, relative);
}

export async function snapshot(
  root: string,
  evidence = false,
): Promise<Record<string, FileFingerprint>> {
  const files: Record<string, FileFingerprint> = {};
  let total = 0;
  async function visit(directory: string): Promise<void> {
    await ownedDirectory(directory);
    const names = await readdir(directory);
    for (const name of names.sort()) {
      const file = path.join(directory, name),
        relative = path.relative(root, file);
      RelativePathSchema.parse(relative);
      const metadata = await lstat(file);
      assert.ok(
        !metadata.isSymbolicLink() && metadata.uid === process.getuid?.(),
      );
      if (metadata.isDirectory()) {
        // The legacy convergence contract excludes all other Obsidian configuration.
        if (!traversable(relative, evidence)) continue;
        await visit(file);
      } else {
        assert.ok(metadata.isFile());
        if (evidence && !evidencePathAllowed(relative)) continue;
        const bytes = await readOwnedBytes(root, relative);
        total += bytes.length;
        assert.ok(
          total <= maximumTotalBytes &&
            Object.keys(files).length < maximumFiles,
        );
        files[relative] = { size: bytes.length, sha256: contentSHA(bytes) };
      }
    }
  }
  await visit(root);
  if (!evidence) {
    try {
      const bytes = await readOwnedBytes(root, settings);
      total += bytes.length;
      assert.ok(
        total <= maximumTotalBytes && Object.keys(files).length < maximumFiles,
      );
      files[settings] = { size: bytes.length, sha256: contentSHA(bytes) };
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
    }
  }
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function traversable(relative: string, evidence: boolean): boolean {
  return evidence
    ? /^(?:journeys(?:\/round-[123](?:\/[A-Za-z0-9][A-Za-z0-9-]{0,100}(?:\/attachments)?)?)?|official-ui(?:\/round-[123])?)$/u.test(
        relative,
      )
    : relative !== ".obsidian";
}

export function writableReferencePath(relative: string): void {
  RelativePathSchema.parse(relative);
  assert.ok(
    relative === settings ||
      relative.startsWith("Tasks/") ||
      relative.startsWith("Attachments/"),
    "Reference mutation is outside the synthetic fixture scope",
  );
}

async function prior(root: string, relative: string, expected: string | null) {
  try {
    const bytes = await readOwnedBytes(root, relative);
    assert.ok(
      expected !== null && contentSHA(bytes) === expected,
      "Reference preimage changed",
    );
    return bytes;
  } catch (error) {
    if (expected === null && hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** Explicit fixture mutations retain displaced bytes outside the synced reference vault. */
export async function referenceApply(
  paths: GuestPaths,
  change: Change,
  requestID: string,
): Promise<string[]> {
  UuidSchema.parse(requestID);
  writableReferencePath(change.path);
  const old = await prior(
    paths.referenceDirectory,
    change.path,
    change.expectedSHA256,
  );
  const recovery = await ownedPath(
    paths.evidenceDirectory,
    `transport-recovery/${requestID}.json`,
    true,
  );
  await writeFile(
    recovery,
    JSON.stringify({
      schemaVersion: 1,
      requestID,
      path: change.path,
      prior: old === null ? null : encodeBlob(old),
    }),
    { flag: "wx", mode: 0o600 },
  );
  if (change.kind === "write") {
    const bytes = decodeBlob(change.blob),
      target = await ownedPath(paths.referenceDirectory, change.path, true);
    const temporary = path.join(
      path.dirname(target),
      `.facet-transport-${requestID}.tmp`,
    );
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await prior(paths.referenceDirectory, change.path, change.expectedSHA256);
    if (change.expectedSHA256 === null) {
      await link(temporary, target);
      await unlink(temporary);
    } else await rename(temporary, target);
    assert.equal(
      contentSHA(await readOwnedBytes(paths.referenceDirectory, change.path)),
      change.blob.sha256,
    );
    return [change.path];
  }
  const source = await ownedPath(paths.referenceDirectory, change.path);
  if (change.kind === "delete") {
    await prior(paths.referenceDirectory, change.path, change.expectedSHA256);
    await unlink(source);
    return [change.path];
  }
  writableReferencePath(change.destination);
  assert.notEqual(change.path, change.destination);
  const destination = await ownedPath(
    paths.referenceDirectory,
    change.destination,
    true,
  );
  await prior(paths.referenceDirectory, change.path, change.expectedSHA256);
  await link(source, destination); // Exclusive destination: never overwrite an unknown peer file.
  assert.equal(
    contentSHA(
      await readOwnedBytes(paths.referenceDirectory, change.destination),
    ),
    change.expectedSHA256,
  );
  await prior(paths.referenceDirectory, change.path, change.expectedSHA256);
  await unlink(source);
  return [change.path, change.destination];
}
