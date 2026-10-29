import {
  cp,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import nodePath from "node:path";
import { CommitSchema, SnapshotSchema, git, verifyObjects } from "./git.ts";
import {
  clearWorkspace,
  GOLDEN_MARKER,
  goldenMarker,
  type GoldenMarker,
} from "./golden.ts";
import { restorePreparedSeed, restoreGradleSeed } from "./prepared.ts";
const { join } = nodePath;

/** No symlinks, config, hooks, credentials, or external object references. */
export async function objectBytes(directory: string): Promise<number> {
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

/**
 * Copy a directory tree with the filesystem's clone facility when it has one.
 * The source cache and the workspace are separate datasets on the CI node's
 * ZFS pool, where `copy_file_range` turns the object store into a block clone
 * instead of a second written copy. GNU cp asks for that with --reflink=auto;
 * BSD cp (developer machines) uses -c for the same thing on APFS.
 */
export async function cloneTree(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(destination, { recursive: true });
  const cloneFlag = process.platform === "darwin" ? "-c" : "--reflink=auto";
  const copy = Bun.spawn(["cp", "-a", cloneFlag, `${source}/.`, destination], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await copy.exited;
  if (code !== 0) {
    throw new Error(
      `cp exited ${String(code)}: ${await new Response(copy.stderr).text()}`,
    );
  }
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
  readonly seedCache?: string;
  readonly incremental?: boolean;
  readonly gradle?: { root: string; image: string };
  readonly prepared?: {
    root: string;
    profile: "verify" | "browser";
    image: string;
  };
};

async function shallowLines(path: string): Promise<string[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  return text.split("\n").filter((line) => line !== "");
}

/**
 * Adds a snapshot's shallow boundaries to the workspace's own. A golden clone
 * keeps its commit's objects, whose boundary must stay recorded or integrity
 * checks would read the missing ancestors as damage. Written by rename: the
 * existing file may belong to another user.
 */
async function mergeShallow(source: string, destination: string) {
  const merged = [
    ...new Set([
      ...(await shallowLines(destination)),
      ...(await shallowLines(source)),
    ]),
  ].toSorted();
  const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
  await Bun.write(temporary, `${merged.join("\n")}\n`);
  await rename(temporary, destination);
}

/** A seed is copied and checked before Git can advertise any of its objects. */
async function restoreObjects(
  snapshot: string,
  workspace: string,
  source: { repository: string; commit: string },
  keepShallow = false,
) {
  const { repository, commit } = source;
  const manifest = SnapshotSchema.parse(
    await Bun.file(join(snapshot, "manifest.json")).json(),
  );
  if (manifest.commit !== commit || manifest.repository !== repository)
    throw new Error("Source cache identity mismatch");
  if ((await objectBytes(join(snapshot, "objects"))) !== manifest.objectBytes)
    throw new Error("Source cache size mismatch");
  await cloneTree(
    join(snapshot, "objects"),
    join(workspace, ".git", "objects"),
  );
  if (keepShallow)
    await mergeShallow(
      join(snapshot, "shallow"),
      join(workspace, ".git", "shallow"),
    );
  else await cp(join(snapshot, "shallow"), join(workspace, ".git", "shallow"));
  if ((await verifyObjects(workspace, commit)) !== manifest.tree)
    throw new Error("Source cache tree mismatch");
  return manifest;
}

async function latestSeed(
  parent: string,
  excluded?: string,
): Promise<string | undefined> {
  const entries = await readdir(parent, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^[a-f\d]{40}$/u.test(entry.name) &&
          entry.name !== excluded,
      )
      .map(async (entry) => {
        const info = await stat(join(parent, entry.name));
        return { commit: entry.name, touched: info.mtimeMs };
      }),
  );
  const ordered = candidates.toSorted(
    (a, b) => b.touched - a.touched || a.commit.localeCompare(b.commit),
  );
  return ordered[0]?.commit;
}

async function seedObjects(
  input: CheckoutInput,
  parent: string,
  key: string,
  commit: string,
) {
  if (input.incremental !== true)
    return { seedSha: undefined, initialBytes: 0 };
  const seedParent =
    input.seedCache === undefined ? parent : join(input.seedCache, "v1", key);
  await mkdir(seedParent, { recursive: true });
  const seedSha = await latestSeed(seedParent, commit);
  if (seedSha === undefined) return { seedSha, initialBytes: 0 };
  const snapshot = join(seedParent, seedSha);
  const manifest = SnapshotSchema.parse(
    await Bun.file(join(snapshot, "manifest.json")).json(),
  );
  if (manifest.commit !== seedSha || manifest.repository !== input.repository)
    throw new Error("Source cache identity mismatch");
  // Stop successive generations accumulating every prior PR's objects.
  // Above this bound a fresh fetch starts a new chain; normal GC retains its
  // existing 8 GiB target for the complete shared source cache.
  if (manifest.objectBytes > 2 * 1024 ** 3)
    return { seedSha: undefined, initialBytes: 0 };
  const seed = await restoreObjects(snapshot, input.workspace, {
    repository: input.repository,
    commit: seedSha,
  });
  await git(input.workspace, ["update-ref", "refs/heads/cache-seed", seedSha]);
  return { seedSha, initialBytes: seed.objectBytes };
}

/**
 * A workflow starts empty or as a golden clone; any other existing checkout
 * is refused, never reset. Prepared seeds restore into an empty workspace, so
 * they clear a clone first: deleting its files writes nothing to the pool.
 */
async function prepareWorkspace(
  input: CheckoutInput,
): Promise<GoldenMarker | undefined> {
  const golden = await goldenMarker(input.workspace);
  if (golden !== undefined && input.prepared === undefined) {
    const remote = await git(input.workspace, [
      "config",
      "--get",
      "remote.origin.url",
    ]);
    if (remote !== input.repository)
      throw new Error(
        "Golden workspace remote differs from the requested source",
      );
    return golden;
  }
  if (golden !== undefined) await clearWorkspace(input.workspace);
  if (await optionalDirectory(join(input.workspace, ".git")))
    throw new Error("Source checkout workspace already has Git metadata");
  await git(input.workspace, ["init", "--quiet"]);
  await git(input.workspace, ["remote", "add", "origin", input.repository]);
  return;
}

/**
 * A golden clone already holds a recent main commit's objects, which a
 * depth-one fetch negotiates against like an incremental seed.
 */
async function goldenObjects(workspace: string) {
  return {
    seedSha: undefined,
    initialBytes: await objectBytes(join(workspace, ".git", "objects")),
  };
}

export async function checkoutSource(input: CheckoutInput) {
  const commit = CommitSchema.parse(input.commit);
  const key = new Bun.CryptoHasher("sha256")
    .update(input.repository)
    .digest("hex");
  const parent = join(input.cache, "v1", key);
  const snapshot = join(parent, commit);
  const started = performance.now();
  const golden = await prepareWorkspace(input);
  // Private benchmark storage may live in .git, which must be initialized first.
  await mkdir(parent, { recursive: true });
  const hit = await optionalDirectory(snapshot);
  let fetchedBytes = 0;
  let downloadMs = 0;
  let tree: string;
  let seedSha: string | undefined;
  if (hit) {
    const restored = await restoreObjects(
      snapshot,
      input.workspace,
      { repository: input.repository, commit },
      golden !== undefined,
    );
    tree = restored.tree;
  } else {
    const seeded =
      golden === undefined
        ? await seedObjects(input, parent, key, commit)
        : await goldenObjects(input.workspace);
    seedSha = seeded.seedSha;
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
    const storedBytes = await objectBytes(
      join(input.workspace, ".git", "objects"),
    );
    fetchedBytes = Math.max(0, storedBytes - seeded.initialBytes);
    const temporary = join(parent, `${commit}.tmp-${crypto.randomUUID()}`);
    await mkdir(temporary);
    await cloneTree(
      join(input.workspace, ".git", "objects"),
      join(temporary, "objects"),
    );
    // Seed objects may have their own shallow boundaries. Preserve all of them
    // so later integrity checks do not interpret missing ancestors as damage.
    const shallow = Bun.file(join(input.workspace, ".git", "shallow"));
    await Bun.write(
      join(temporary, "shallow"),
      (await shallow.exists()) ? await shallow.text() : `${commit}\n`,
    );
    await Bun.write(
      join(temporary, "manifest.json"),
      JSON.stringify({
        version: 1,
        repository: input.repository,
        commit,
        tree,
        objectBytes: storedBytes,
      }),
    );
    await rename(temporary, snapshot);
    if (seedSha !== undefined)
      await git(input.workspace, ["update-ref", "-d", "refs/heads/cache-seed"]);
  }
  const materializeStarted = performance.now();
  const prepared =
    input.prepared === undefined
      ? { hit: false, sourceSha: null }
      : await restorePreparedSeed({
          workspace: input.workspace,
          commit,
          ...input.prepared,
        });
  const gradle =
    input.gradle === undefined
      ? false
      : await restoreGradleSeed(
          input.workspace,
          input.gradle.root,
          commit,
          input.gradle.image,
        );
  // A golden clone keeps its index, so only files that differ from the golden
  // commit are written. Status first refreshes the index's stat data, which a
  // copy that renumbers inodes would otherwise make every file look modified.
  if (golden !== undefined)
    await git(input.workspace, [
      "status",
      "--porcelain",
      "--untracked-files=no",
    ]);
  await git(input.workspace, ["reset", "--hard", "--quiet", commit]);
  if ((await git(input.workspace, ["rev-parse", "HEAD"])) !== commit)
    throw new Error("Materialized checkout head mismatch");
  if (golden !== undefined) await rm(join(input.workspace, GOLDEN_MARKER));
  const now = new Date();
  await utimes(snapshot, now, now);
  return {
    schemaVersion: 1,
    sourceSha: commit,
    tree,
    cache: hit ? "hit" : "miss",
    seedSha: seedSha ?? null,
    goldenSha: golden?.commit ?? null,
    prepared,
    gradle,
    // Stored Git object bytes, not estimated TCP/TLS wire bytes.
    downloadedObjectBytes: fetchedBytes,
    downloadMs: Math.round(downloadMs),
    materializationMs: Math.round(performance.now() - materializeStarted),
    totalMs: Math.round(performance.now() - started),
  };
}
