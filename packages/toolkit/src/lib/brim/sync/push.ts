import { sha256Hex, type Opener, type Sealer } from "./crypto.ts";
import { SyncSetupError } from "./errors.ts";
import {
  emptyManifest,
  fileKeyFor,
  generationPrefix,
  manifestJson,
  manifestKey,
  parseManifest,
  readLocalManifest,
  segmentKey,
  writePrivateFile,
  type Manifest,
  type ManifestFile,
} from "./manifest.ts";
import type { ObjectStore } from "./object-store.ts";
import type { BrimSyncPaths } from "./paths.ts";
import { scanSourceFiles, type SourceFile, type SyncRoot } from "./scan.ts";

const TAIL_BYTES = 4096;
const NEWLINE = 0x0a;
const MIB = 1024 * 1024;

export type PushOptions = {
  readonly store: ObjectStore;
  readonly seal: Sealer;
  /** Only needed to adopt a remote manifest when local state was lost. */
  readonly open: Opener | null;
  readonly paths: BrimSyncPaths;
  readonly machineId: string;
  readonly displayName: string;
  readonly platform: string;
  readonly roots: readonly SyncRoot[];
  readonly now?: () => Date;
  readonly segmentLimitBytes?: number;
  readonly commitEveryBytes?: number;
  readonly log?: (line: string) => void;
};

export type PushReport = {
  readonly files: number;
  readonly changedFiles: number;
  readonly rewrittenFiles: number;
  readonly newlyDeletedFiles: number;
  readonly uploadedSegments: number;
  readonly uploadedBytes: number;
  readonly commits: number;
  readonly errors: readonly { relPath: string; message: string }[];
};

function entryId(tool: string, relPath: string): string {
  return `${tool}:${relPath}`;
}

async function readRange(
  file: string,
  start: number,
  end: number,
): Promise<Uint8Array> {
  const bytes = await Bun.file(file).slice(start, end).bytes();
  if (bytes.length !== end - start) {
    throw new Error(
      `short read: wanted ${String(end - start)} bytes at ${String(start)}, got ${String(bytes.length)}`,
    );
  }
  return bytes;
}

async function tailHash(file: string, size: number): Promise<string> {
  return sha256Hex(await readRange(file, Math.max(0, size - TAIL_BYTES), size));
}

/** Loads push state, adopting the remote manifest if the local copy is gone. */
async function loadManifest(
  options: PushOptions,
  now: Date,
): Promise<Manifest> {
  const local = await readLocalManifest(options.paths.manifest);
  if (local !== null) {
    if (local.machineId !== options.machineId) {
      throw new SyncSetupError(
        `Local sync state belongs to machine "${local.machineId}", not "${options.machineId}". Set brim.sync.machine.id back or move ${options.paths.manifest} aside.`,
      );
    }
    return local;
  }
  const remote = await options.store.get(manifestKey(options.machineId));
  if (remote === null) {
    return emptyManifest({
      machineId: options.machineId,
      displayName: options.displayName,
      platform: options.platform,
      now,
    });
  }
  if (options.open === null) {
    throw new SyncSetupError(
      `Machine "${options.machineId}" already has an archive but ${options.paths.manifest} is missing. Provide BRIM_SYNC_AGE_IDENTITY once so push can adopt the remote manifest.`,
    );
  }
  const adopted = parseManifest(
    new TextDecoder().decode(await options.open(remote)),
    `remote manifest for ${options.machineId}`,
  );
  if (adopted.machineId !== options.machineId) {
    throw new SyncSetupError(
      `Remote manifest at ${manifestKey(options.machineId)} names machine "${adopted.machineId}".`,
    );
  }
  options.log?.(
    `Adopted the remote manifest for ${options.machineId} (${String(adopted.files.length)} files).`,
  );
  return adopted;
}

type PushRun = {
  readonly options: PushOptions;
  readonly manifest: Manifest;
  readonly now: () => Date;
  bytesSinceCommit: number;
  dirty: boolean;
  commits: number;
  uploadedSegments: number;
  uploadedBytes: number;
};

async function commit(run: PushRun): Promise<void> {
  const { options, manifest } = run;
  manifest.updatedAt = run.now().toISOString();
  const json = manifestJson(manifest);
  await options.store.put(
    manifestKey(options.machineId),
    await options.seal(new TextEncoder().encode(json)),
  );
  await writePrivateFile(options.paths.manifest, json);
  run.commits += 1;
  run.bytesSinceCommit = 0;
  run.dirty = false;
}

/** Deletes segments of generations that a committed manifest superseded. */
async function purgeRetired(run: PushRun): Promise<void> {
  const { options, manifest } = run;
  if (manifest.retired.length === 0) return;
  for (const retired of manifest.retired) {
    const prefix = generationPrefix(
      options.machineId,
      retired.fileKey,
      retired.gen,
    );
    for (const key of await options.store.listKeys(prefix)) {
      await options.store.delete(key);
    }
  }
  manifest.retired = [];
  run.dirty = true;
}

function freshEntry(source: SourceFile, gen: number): ManifestFile {
  return {
    tool: source.tool,
    relPath: source.relPath,
    fileKey: fileKeyFor(source.tool, source.relPath),
    gen,
    size: 0,
    mtimeMs: source.mtimeMs,
    tailSha256: sha256Hex(new Uint8Array()),
    deletedAt: null,
    segments: [],
  };
}

/** True when the archived bytes are no longer a prefix of the source. */
async function wasRewritten(
  entry: ManifestFile,
  source: SourceFile,
): Promise<boolean> {
  if (source.size < entry.size) return true;
  if (entry.size === 0) return false;
  const tail = await tailHash(source.absolutePath, entry.size);
  return tail !== entry.tailSha256;
}

async function uploadNewLines(
  run: PushRun,
  entry: ManifestFile,
  source: SourceFile,
): Promise<void> {
  const limit = run.options.segmentLimitBytes ?? 64 * MIB;
  const commitEvery = run.options.commitEveryBytes ?? 256 * MIB;
  while (entry.size < source.size) {
    const end = Math.min(source.size, entry.size + limit);
    const chunk = await readRange(source.absolutePath, entry.size, end);
    const lastNewline = chunk.lastIndexOf(NEWLINE);
    if (lastNewline === -1) {
      if (end === source.size) return; // an unfinished last line; wait for it
      throw new Error(
        `a single line exceeds ${String(limit / MIB)} MiB at byte ${String(entry.size)}`,
      );
    }
    const segment = chunk.subarray(0, lastNewline + 1);
    const offset = entry.size;
    await run.options.store.put(
      segmentKey(run.options.machineId, entry.fileKey, entry.gen, offset),
      await run.options.seal(segment),
    );
    entry.segments.push({
      offset,
      length: segment.length,
      sha256: sha256Hex(segment),
    });
    entry.size += segment.length;
    entry.mtimeMs = source.mtimeMs;
    entry.tailSha256 = await tailHash(source.absolutePath, entry.size);
    run.uploadedSegments += 1;
    run.uploadedBytes += segment.length;
    run.bytesSinceCommit += segment.length;
    run.dirty = true;
    if (run.bytesSinceCommit >= commitEvery) {
      await commit(run);
      run.options.log?.(
        `Committed ${String(run.uploadedBytes)} bytes so far (${source.relPath}).`,
      );
    }
  }
}

function markDeleted(run: PushRun, present: ReadonlySet<string>): number {
  let newlyDeleted = 0;
  for (const entry of run.manifest.files) {
    if (present.has(entryId(entry.tool, entry.relPath))) continue;
    if (entry.deletedAt === null) {
      entry.deletedAt = run.now().toISOString();
      newlyDeleted += 1;
      run.dirty = true;
    }
  }
  return newlyDeleted;
}

type FileOutcome = { readonly changed: boolean; readonly rewritten: boolean };

/** Archives one source file's new lines, starting a generation if needed. */
async function archiveSource(
  run: PushRun,
  entries: Map<string, ManifestFile>,
  source: SourceFile,
): Promise<FileOutcome> {
  const id = entryId(source.tool, source.relPath);
  let entry = entries.get(id);
  let rewritten = false;
  if (entry === undefined) {
    entry = freshEntry(source, 0);
    run.manifest.files.push(entry);
    entries.set(id, entry);
  } else if (await wasRewritten(entry, source)) {
    run.manifest.retired.push({ fileKey: entry.fileKey, gen: entry.gen });
    Object.assign(entry, freshEntry(source, entry.gen + 1));
    rewritten = true;
  }
  if (entry.deletedAt !== null) {
    entry.deletedAt = null;
    run.dirty = true;
  }
  const before = entry.size;
  await uploadNewLines(run, entry, source);
  // A touched-but-unchanged file: remember the mtime so the fast path skips
  // it next time.
  if (entry.size === source.size && entry.mtimeMs !== source.mtimeMs) {
    entry.mtimeMs = source.mtimeMs;
    run.dirty = true;
  }
  return { changed: entry.size !== before, rewritten };
}

function unchanged(
  entry: ManifestFile | undefined,
  source: SourceFile,
): boolean {
  return (
    entry?.deletedAt === null &&
    entry.size === source.size &&
    entry.mtimeMs === source.mtimeMs
  );
}

/**
 * Archives every new complete line of every transcript. Idempotent: a run
 * that crashes resumes from the last committed manifest, and re-uploading a
 * segment under the same key is harmless.
 */
export async function pushArchive(options: PushOptions): Promise<PushReport> {
  const now = options.now ?? (() => new Date());
  const manifest = await loadManifest(options, now());
  const run: PushRun = {
    options,
    manifest,
    now,
    bytesSinceCommit: 0,
    dirty: false,
    commits: 0,
    uploadedSegments: 0,
    uploadedBytes: 0,
  };
  const sources = await scanSourceFiles(options.roots);
  const entries = new Map(
    manifest.files.map((entry) => [entryId(entry.tool, entry.relPath), entry]),
  );
  const newlyDeletedFiles = markDeleted(
    run,
    new Set(sources.map((source) => entryId(source.tool, source.relPath))),
  );
  const errors: { relPath: string; message: string }[] = [];
  let changedFiles = 0;
  let rewrittenFiles = 0;
  for (const source of sources) {
    if (unchanged(entries.get(entryId(source.tool, source.relPath)), source)) {
      continue;
    }
    try {
      const outcome = await archiveSource(run, entries, source);
      if (outcome.changed) changedFiles += 1;
      if (outcome.rewritten) rewrittenFiles += 1;
    } catch (error: unknown) {
      errors.push({
        relPath: source.relPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (run.dirty) await commit(run);
  if (manifest.retired.length > 0) {
    await purgeRetired(run);
    await commit(run);
  }
  return {
    files: manifest.files.length,
    changedFiles,
    rewrittenFiles,
    newlyDeletedFiles,
    uploadedSegments: run.uploadedSegments,
    uploadedBytes: run.uploadedBytes,
    commits: run.commits,
    errors,
  };
}
