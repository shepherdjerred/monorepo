import {
  appendFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sha256Hex, type Opener } from "./crypto.ts";
import {
  ARCHIVE_PREFIX,
  MACHINE_ID_PATTERN,
  manifestKey,
  parseManifest,
  segmentKey,
  writePrivateFile,
  type Manifest,
  type ManifestFile,
} from "./manifest.ts";
import {
  MIRROR_INDEX_SCHEMA_VERSION,
  mirrorRoots,
  readMirrorIndex,
  type MirrorIndex,
  type MirrorMachine,
} from "./mirror-index.ts";
import type { ObjectStore } from "./object-store.ts";
import {
  fromArchivePath,
  mirrorMachineDir,
  type BrimSyncPaths,
} from "./paths.ts";

const DAY_MS = 86_400_000;

const PullStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  machines: z.record(
    z.string(),
    z.record(
      z.string(),
      z.strictObject({
        gen: z.number().int().nonnegative(),
        size: z.number().int().nonnegative(),
      }),
    ),
  ),
});
type PullState = z.infer<typeof PullStateSchema>;

export type PullOptions = {
  readonly store: ObjectStore;
  readonly open: Opener;
  readonly paths: BrimSyncPaths;
  /** This machine; its own archive is never pulled. */
  readonly machineId: string;
  /** Mirror files whose source changed in the last N days; `null` for all. */
  readonly sinceDays: number | null;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
};

export type PullMachineReport = {
  readonly machineId: string;
  readonly mirroredFiles: number;
  readonly downloadedSegments: number;
  readonly downloadedBytes: number;
  readonly rebuiltFiles: number;
  readonly prunedFiles: number;
};

export type PullReport = {
  readonly machines: readonly PullMachineReport[];
  readonly errors: readonly { machineId: string; message: string }[];
};

async function readPullState(file: string): Promise<PullState> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return { schemaVersion: 1, machines: {} };
  const raw: unknown = JSON.parse(await handle.text());
  return PullStateSchema.parse(raw);
}

async function sizeOf(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.size;
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function filesUnder(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, {
      withFileTypes: true,
      recursive: true,
    });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

type MachineRun = {
  readonly options: PullOptions;
  readonly manifest: Manifest;
  readonly rootDir: string;
  readonly state: Record<string, { gen: number; size: number }>;
  downloadedSegments: number;
  downloadedBytes: number;
  rebuiltFiles: number;
};

async function openSegment(
  run: MachineRun,
  entry: ManifestFile,
  segment: ManifestFile["segments"][number],
): Promise<Uint8Array> {
  const key = segmentKey(
    run.manifest.machineId,
    entry.fileKey,
    entry.gen,
    segment.offset,
  );
  const sealed = await run.options.store.get(key);
  if (sealed === null) {
    throw new Error(`segment ${key} named by the manifest is missing`);
  }
  const bytes = await run.options.open(sealed);
  if (bytes.length !== segment.length || sha256Hex(bytes) !== segment.sha256) {
    throw new Error(`segment ${key} does not match its manifest checksum`);
  }
  return bytes;
}

/** Brings one mirror file up to the manifest, appending when it can. */
async function mirrorFile(run: MachineRun, entry: ManifestFile): Promise<void> {
  const id = `${entry.tool}:${entry.relPath}`;
  const target = fromArchivePath(
    path.join(run.rootDir, entry.tool),
    entry.relPath,
  );
  const known = run.state[id];
  const actual = await sizeOf(target);
  const appendable =
    known?.gen === entry.gen &&
    actual === known.size &&
    known.size <= entry.size &&
    (known.size === 0 ||
      entry.segments.some(
        (segment) => segment.offset + segment.length === known.size,
      ));
  const start = appendable ? known.size : 0;
  if (appendable && start === entry.size) return;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const destination = appendable ? target : `${target}.partial`;
  if (!appendable) {
    await rm(destination, { force: true });
    await Bun.write(destination, "");
    run.rebuiltFiles += 1;
  }
  for (const segment of entry.segments) {
    if (segment.offset < start) continue;
    const bytes = await openSegment(run, entry, segment);
    await appendFile(destination, bytes, { mode: 0o600 });
    run.downloadedSegments += 1;
    run.downloadedBytes += bytes.length;
  }
  if (!appendable) await rename(destination, target);
  const mtime = new Date(entry.mtimeMs);
  await utimes(target, mtime, mtime);
  run.state[id] = { gen: entry.gen, size: entry.size };
}

async function fetchManifest(
  options: PullOptions,
  machineId: string,
): Promise<Manifest> {
  const sealed = await options.store.get(manifestKey(machineId));
  if (sealed === null) {
    throw new Error(`no manifest at ${manifestKey(machineId)}`);
  }
  const manifest = parseManifest(
    new TextDecoder().decode(await options.open(sealed)),
    `manifest for ${machineId}`,
  );
  if (manifest.machineId !== machineId) {
    throw new Error(
      `manifest under ${machineId}/ names machine "${manifest.machineId}"`,
    );
  }
  return manifest;
}

async function pullMachine(
  options: PullOptions,
  machineId: string,
  pullState: PullState,
  now: Date,
): Promise<{ report: PullMachineReport; machine: MirrorMachine }> {
  const manifest = await fetchManifest(options, machineId);
  const rootDir = mirrorMachineDir(options.paths, machineId);
  const cutoff =
    options.sinceDays === null
      ? null
      : now.getTime() - options.sinceDays * DAY_MS;
  const wanted = manifest.files.filter(
    (entry) => cutoff === null || entry.mtimeMs >= cutoff,
  );
  const state = pullState.machines[machineId] ?? {};
  pullState.machines[machineId] = state;
  const run: MachineRun = {
    options,
    manifest,
    rootDir,
    state,
    downloadedSegments: 0,
    downloadedBytes: 0,
    rebuiltFiles: 0,
  };
  for (const entry of wanted) {
    await mirrorFile(run, entry);
  }
  const keep = new Set(
    wanted.map((entry) =>
      fromArchivePath(path.join(rootDir, entry.tool), entry.relPath),
    ),
  );
  let prunedFiles = 0;
  for (const file of await filesUnder(rootDir)) {
    if (keep.has(file)) continue;
    await rm(file, { force: true });
    prunedFiles += 1;
  }
  for (const id of Object.keys(state)) {
    const [tool, ...rest] = id.split(":");
    const relPath = rest.join(":");
    if (
      !wanted.some((entry) => entry.tool === tool && entry.relPath === relPath)
    ) {
      Reflect.deleteProperty(state, id);
    }
  }
  return {
    report: {
      machineId,
      mirroredFiles: wanted.length,
      downloadedSegments: run.downloadedSegments,
      downloadedBytes: run.downloadedBytes,
      rebuiltFiles: run.rebuiltFiles,
      prunedFiles,
    },
    machine: {
      machineId,
      displayName: manifest.displayName,
      platform: manifest.platform,
      manifestUpdatedAt: manifest.updatedAt,
      pulledAt: now.toISOString(),
      sinceDays: options.sinceDays,
      rootDir,
      ...mirrorRoots(rootDir, wanted),
    },
  };
}

/**
 * Mirrors every other machine's archive into a read-only local tree and
 * rewrites the mirror index. A machine that fails keeps its previous index
 * entry and files, so one unreachable manifest never hides older data.
 */
export async function pullArchive(options: PullOptions): Promise<PullReport> {
  const now = (options.now ?? (() => new Date()))();
  const pullState = await readPullState(options.paths.pullState);
  const previous = await readMirrorIndex(options.paths.mirrorIndex);
  const children = await options.store.listChildren(ARCHIVE_PREFIX);
  const machineIds = children
    .filter((id) => id !== options.machineId)
    .toSorted();
  const reports: PullMachineReport[] = [];
  const errors: { machineId: string; message: string }[] = [];
  const machines: MirrorMachine[] = [];
  for (const machineId of machineIds) {
    if (!MACHINE_ID_PATTERN.test(machineId)) {
      errors.push({ machineId, message: "invalid machine id in bucket" });
      continue;
    }
    try {
      const result = await pullMachine(options, machineId, pullState, now);
      reports.push(result.report);
      machines.push(result.machine);
      options.log?.(
        `${machineId}: ${String(result.report.mirroredFiles)} files, ${String(result.report.downloadedBytes)} new bytes`,
      );
    } catch (error: unknown) {
      errors.push({
        machineId,
        message: error instanceof Error ? error.message : String(error),
      });
      const kept = previous?.machines.find(
        (machine) => machine.machineId === machineId,
      );
      if (kept !== undefined) machines.push(kept);
    }
  }
  await writePrivateFile(
    options.paths.pullState,
    `${JSON.stringify(pullState, null, 2)}\n`,
  );
  const index: MirrorIndex = {
    schemaVersion: MIRROR_INDEX_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    machines,
  };
  await writePrivateFile(
    options.paths.mirrorIndex,
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return { machines: reports, errors };
}
