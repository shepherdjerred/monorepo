import {
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  stat,
  utimes,
} from "node:fs/promises";
import nodePath from "node:path";
import { CommitSchema, SnapshotSchema, git, verifyObjects } from "./git.ts";
const { join } = nodePath;

/** No symlinks, config, hooks, credentials, or external object references. */
async function objectBytes(directory: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error("Source object cache contains a symlink");
    if (entry.name === "alternates" || entry.name === "http-alternates")
      throw new Error("Source object cache contains an external reference");
    if (entry.isDirectory()) bytes += await objectBytes(path);
    else if (entry.isFile()) {
      const info = await stat(path);
      bytes += info.size;
    } else
      throw new Error("Source object cache contains an unexpected file type");
  }
  return bytes;
}

async function optionalDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Invalid source snapshot directory");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

export type CheckoutInput = {
  readonly workspace: string;
  readonly repository: string;
  readonly commit: string;
  /** The caller holds a shared GC lock, plus an exclusive commit lock on misses. */
  readonly cache: string;
};

export async function checkoutSource(input: CheckoutInput) {
  const commit = CommitSchema.parse(input.commit);
  const key = new Bun.CryptoHasher("sha256")
    .update(input.repository)
    .digest("hex");
  const parent = join(input.cache, "v1", key);
  const snapshot = join(parent, commit);
  const started = performance.now();
  await mkdir(parent, { recursive: true });
  // A workflow starts with an empty workspace. Never reset an existing checkout.
  if (await optionalDirectory(join(input.workspace, ".git")))
    throw new Error("Source checkout workspace already has Git metadata");
  await git(input.workspace, ["init", "--quiet"]);
  await git(input.workspace, ["remote", "add", "origin", input.repository]);
  const hit = await optionalDirectory(snapshot);
  let fetchedBytes = 0;
  let downloadMs = 0;
  let tree: string;
  if (hit) {
    const manifest = SnapshotSchema.parse(
      await Bun.file(join(snapshot, "manifest.json")).json(),
    );
    if (manifest.commit !== commit || manifest.repository !== input.repository)
      throw new Error("Source cache identity mismatch");
    const bytes = await objectBytes(join(snapshot, "objects"));
    if (bytes !== manifest.objectBytes)
      throw new Error("Source cache size mismatch");
    await cp(
      join(snapshot, "objects"),
      join(input.workspace, ".git", "objects"),
      { recursive: true },
    );
    await cp(
      join(snapshot, "shallow"),
      join(input.workspace, ".git", "shallow"),
    );
    tree = await verifyObjects(input.workspace, commit);
    if (tree !== manifest.tree) throw new Error("Source cache tree mismatch");
  } else {
    const downloadStarted = performance.now();
    // Eager depth-one fetch: no tree:0 filter and no lazy checkout hydration.
    await git(input.workspace, [
      "fetch",
      "--no-tags",
      "--depth=1",
      "--no-filter",
      "origin",
      `+${commit}:`,
    ]);
    downloadMs = performance.now() - downloadStarted;
    tree = await verifyObjects(input.workspace, commit);
    fetchedBytes = await objectBytes(join(input.workspace, ".git", "objects"));
    const temporary = join(parent, `${commit}.tmp-${crypto.randomUUID()}`);
    await mkdir(temporary);
    await cp(
      join(input.workspace, ".git", "objects"),
      join(temporary, "objects"),
      { recursive: true },
    );
    // A root commit has no shallow file; write the known depth-one boundary.
    await Bun.write(join(temporary, "shallow"), `${commit}\n`);
    await Bun.write(
      join(temporary, "manifest.json"),
      JSON.stringify({
        version: 1,
        repository: input.repository,
        commit,
        tree,
        objectBytes: fetchedBytes,
      }),
    );
    await rename(temporary, snapshot);
  }
  const materializeStarted = performance.now();
  await git(input.workspace, ["reset", "--hard", "--quiet", commit]);
  if ((await git(input.workspace, ["rev-parse", "HEAD"])) !== commit)
    throw new Error("Materialized checkout head mismatch");
  const now = new Date();
  await utimes(snapshot, now, now);
  return {
    schemaVersion: 1,
    sourceSha: commit,
    tree,
    cache: hit ? "hit" : "miss",
    // Stored Git object bytes, not estimated TCP/TLS wire bytes.
    downloadedObjectBytes: fetchedBytes,
    downloadMs: Math.round(downloadMs),
    materializationMs: Math.round(performance.now() - materializeStarted),
    totalMs: Math.round(performance.now() - started),
  };
}
