import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "#src/logger.ts";

/** A minimal typed facade over emscripten's FS API — just the calls save-persistence needs. */
export type FsModule = {
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (path: string) => Uint8Array;
  readdir: (path: string) => string[];
  mkdir: (path: string) => void;
  /** Returns an object with a `mode` field; on emscripten, isDir bit = 0o040000. */
  stat: (path: string) => { mode: number };
};

/** Emscripten encodes "is directory" in mode the same way POSIX does. */
const EMSCRIPTEN_DIR_MODE_BIT = 0o04_0000;

/**
 * MEMFS paths the host stages at init (config + emscripten assets + ROM marker).
 * `persistMemfsToHost()` skips these so we never snapshot config/runtime files
 * as if they were saves.
 */
export const STAGED_ASSET_PATHS: ReadonlySet<string> = new Set([
  "config.txt",
  "shader_vert.hlsl",
  "shader_frag.hlsl",
  "overlay.png",
  "res/arial.ttf",
  "custom.v64",
]);

/** Top-level MEMFS dirs we never recurse into for save snapshotting. */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  "dev",
  "proc",
  "tmp",
  "home",
]);

/**
 * Walk the wasm's MEMFS and write every file that isn't a known staged asset
 * to `savesDir` on the host. Idempotent and best-effort: per-file errors are
 * logged but don't fail the call (better to snapshot what we can than lose
 * everything because one path is unreadable).
 */
export async function persistMemfsToHost(
  fs: FsModule,
  savesDir: string,
): Promise<void> {
  try {
    await mkdir(savesDir, { recursive: true });
  } catch (error) {
    logger.warn("persistMemfsToHost: failed to ensure savesDir", error);
    return;
  }
  let count = 0;
  for (const memfsPath of walkMemfs(fs, "/")) {
    const rel = memfsPath.replace(/^\/+/, "");
    if (STAGED_ASSET_PATHS.has(rel)) continue;
    try {
      const bytes = fs.readFile(memfsPath);
      const target = path.join(savesDir, rel);
      await mkdir(path.dirname(target), { recursive: true });
      await Bun.write(target, bytes);
      count += 1;
    } catch (error) {
      logger.warn(`persistMemfsToHost: skipped ${memfsPath}`, error);
    }
  }
  logger.info("persisted MEMFS save state", {
    savesDir,
    files: count,
  });
}

/**
 * Mirror the contents of host `savesDir` into MEMFS, recreating subdirs as
 * needed. Called BEFORE `callMain` so the core's `loadFile()` etc. can find
 * the previously-persisted save state. No-op when `savesDir` does not exist
 * (first session for a guild).
 */
export async function restoreHostToMemfs(
  fs: FsModule,
  savesDir: string,
): Promise<void> {
  try {
    const stats = await stat(savesDir);
    if (!stats.isDirectory()) return;
  } catch {
    // savesDir doesn't exist yet (first session for this guild) — nothing to restore.
    return;
  }
  let restored = 0;
  for await (const entry of walkHost(savesDir)) {
    const relative = path.relative(savesDir, entry);
    if (STAGED_ASSET_PATHS.has(relative)) continue;
    try {
      const bytes = await Bun.file(entry).arrayBuffer();
      const memfsPath = `/${relative.split(path.sep).join("/")}`;
      const dir = memfsPath.split("/").slice(0, -1).join("/");
      if (dir !== "" && dir !== "/") {
        ensureMemfsDir(fs, dir);
      }
      fs.writeFile(memfsPath, new Uint8Array(bytes));
      restored += 1;
    } catch (error) {
      logger.warn(`restoreHostToMemfs: skipped ${entry}`, error);
    }
  }
  if (restored > 0) {
    logger.info("restored MEMFS save state", { savesDir, files: restored });
  }
}

/**
 * Walk every file in MEMFS reachable from `root`, yielding absolute MEMFS paths.
 * Skips top-level emscripten virtual dirs (`/dev`, `/proc`, ...) so we don't
 * snapshot runtime device nodes.
 */
function* walkMemfs(fs: FsModule, root: string): Generator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    let entries: string[];
    try {
      entries = fs.readdir(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry === "." || entry === "..") continue;
      const full = current === "/" ? `/${entry}` : `${current}/${entry}`;
      if (current === "/" && EXCLUDED_DIRS.has(entry)) continue;
      let mode: number;
      try {
        mode = fs.stat(full).mode;
      } catch {
        continue;
      }
      const isDir = (mode & EMSCRIPTEN_DIR_MODE_BIT) !== 0;
      if (isDir) {
        stack.push(full);
      } else {
        yield full;
      }
    }
  }
}

/** Create every intermediate directory in a MEMFS path; idempotent. */
function ensureMemfsDir(fs: FsModule, dirPath: string): void {
  const parts = dirPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      fs.mkdir(current);
    } catch {
      /* already exists */
    }
  }
}

/** Recursively yield every file path under a host directory. */
async function* walkHost(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkHost(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
