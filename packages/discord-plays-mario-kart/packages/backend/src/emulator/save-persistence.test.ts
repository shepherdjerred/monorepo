import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  persistMemfsToHost,
  restoreHostToMemfs,
  STAGED_ASSET_PATHS,
  type FsModule,
} from "./save-persistence.ts";

const DIR_MODE = 0o04_0000;
const FILE_MODE = 0o10_0000;

/**
 * Minimal in-memory FsModule fake that mimics emscripten's MEMFS surface:
 * paths are absolute (`/foo/bar`), directories created via `mkdir`, files
 * stored as Uint8Array, and stat returns POSIX-shaped modes.
 */
function norm(p: string): string {
  if (!p.startsWith("/")) return `/${p}`;
  return p;
}
function dirname(p: string): string {
  const parts = norm(p).split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}
function basename(p: string): string {
  const parts = norm(p).split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function fakeFs(): FsModule & {
  list: () => Map<string, Uint8Array>;
  dirs: () => Set<string>;
} {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(["/"]);

  return {
    writeFile: (p, data) => {
      const full = norm(p);
      const parent = dirname(full);
      if (!dirs.has(parent)) {
        throw new Error(`parent dir missing: ${parent}`);
      }
      const bytes = typeof data === "string" ? Buffer.from(data) : data;
      files.set(full, new Uint8Array(bytes));
    },
    readFile: (p) => {
      const full = norm(p);
      const bytes = files.get(full);
      if (bytes === undefined) throw new Error(`no such file: ${full}`);
      return bytes;
    },
    readdir: (p) => {
      const full = norm(p);
      if (!dirs.has(full)) throw new Error(`no such dir: ${full}`);
      const out = new Set<string>([".", ".."]);
      const prefix = full === "/" ? "/" : `${full}/`;
      for (const fp of files.keys()) {
        if (!fp.startsWith(prefix)) continue;
        const rest = fp.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first !== undefined) out.add(first);
      }
      for (const d of dirs) {
        if (d === full) continue;
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first !== undefined && first.length > 0) out.add(first);
      }
      return [...out];
    },
    mkdir: (p) => {
      const full = norm(p);
      dirs.add(full);
    },
    stat: (p) => {
      const full = norm(p);
      if (dirs.has(full)) return { mode: DIR_MODE };
      if (files.has(full)) return { mode: FILE_MODE };
      throw new Error(`no such path: ${full} (basename=${basename(full)})`);
    },
    list: () => files,
    dirs: () => dirs,
  };
}

let savesDir: string;
let dirCounter = 0;

beforeEach(async () => {
  dirCounter += 1;
  savesDir = path.join(
    tmpdir(),
    `mk64-save-test-${String(process.pid)}-${String(dirCounter)}`,
  );
  await mkdir(savesDir, { recursive: true });
});
afterEach(async () => {
  await rm(savesDir, { recursive: true, force: true });
});

describe("persistMemfsToHost", () => {
  test("writes MEMFS files to host savesDir, skipping staged assets", async () => {
    const fs = fakeFs();
    for (const asset of STAGED_ASSET_PATHS) {
      const parent = `/${asset.split("/").slice(0, -1).join("/")}`;
      if (parent !== "/" && parent.length > 1) fs.mkdir(parent);
      fs.writeFile(`/${asset}`, new Uint8Array([0xff]));
    }
    fs.writeFile("/mempak.bin", new Uint8Array([1, 2, 3]));
    fs.mkdir("/saves");
    fs.writeFile("/saves/eep.bin", new Uint8Array([4, 5, 6]));

    await persistMemfsToHost(fs, savesDir);

    const mempak = await Bun.file(path.join(savesDir, "mempak.bin")).bytes();
    expect([...mempak]).toEqual([1, 2, 3]);
    const eep = await Bun.file(path.join(savesDir, "saves", "eep.bin")).bytes();
    expect([...eep]).toEqual([4, 5, 6]);
    // Staged assets must NOT be snapshotted.
    for (const asset of STAGED_ASSET_PATHS) {
      const exists = await Bun.file(path.join(savesDir, asset)).exists();
      expect(exists).toBe(false);
    }
  });

  test("skips /dev /proc /tmp /home top-level virtual dirs", async () => {
    const fs = fakeFs();
    fs.mkdir("/dev");
    fs.writeFile("/dev/null", new Uint8Array([0]));
    fs.mkdir("/proc");
    fs.writeFile("/proc/self", new Uint8Array([0]));
    fs.writeFile("/save.bin", new Uint8Array([42]));

    await persistMemfsToHost(fs, savesDir);
    const entries = await readdir(savesDir);
    expect(entries).toContain("save.bin");
    expect(entries).not.toContain("dev");
    expect(entries).not.toContain("proc");
  });
});

describe("restoreHostToMemfs", () => {
  test("mirrors files from host savesDir into MEMFS, recreating subdirs", async () => {
    await writeFile(path.join(savesDir, "mempak.bin"), new Uint8Array([1, 2]));
    await mkdir(path.join(savesDir, "save"));
    await writeFile(
      path.join(savesDir, "save", "eep.bin"),
      new Uint8Array([3, 4]),
    );

    const fs = fakeFs();
    await restoreHostToMemfs(fs, savesDir);

    expect([...fs.readFile("/mempak.bin")]).toEqual([1, 2]);
    expect([...fs.readFile("/save/eep.bin")]).toEqual([3, 4]);
  });

  test("no-ops when savesDir does not exist (first session for guild)", async () => {
    const fs = fakeFs();
    const missing = path.join(tmpdir(), `mk64-missing-${String(Date.now())}`);
    await restoreHostToMemfs(fs, missing);
    expect(fs.list().size).toBe(0);
  });

  test("skips staged-asset filenames if they appeared in savesDir", async () => {
    await writeFile(path.join(savesDir, "config.txt"), new Uint8Array([99]));
    await writeFile(path.join(savesDir, "mempak.bin"), new Uint8Array([1]));
    const fs = fakeFs();
    await restoreHostToMemfs(fs, savesDir);
    expect(fs.list().has("/config.txt")).toBe(false);
    expect(fs.list().has("/mempak.bin")).toBe(true);
  });
});

describe("round-trip", () => {
  test("persist → restore reproduces the same file contents (per-guild isolation)", async () => {
    // Server A persists some saves.
    const fsA = fakeFs();
    fsA.writeFile("/save.bin", new Uint8Array([0xaa, 0xbb, 0xcc]));
    fsA.mkdir("/mp");
    fsA.writeFile("/mp/controller-1.bin", new Uint8Array([1, 2, 3, 4]));
    await persistMemfsToHost(fsA, savesDir);

    // Server B has its own MEMFS but a DIFFERENT savesDir — restoring B's
    // (empty) dir leaves B's MEMFS clean (no A saves leak in).
    dirCounter += 1;
    const savesDirB = path.join(
      tmpdir(),
      `mk64-save-test-B-${String(process.pid)}-${String(dirCounter)}`,
    );
    await mkdir(savesDirB, { recursive: true });
    try {
      const fsB = fakeFs();
      await restoreHostToMemfs(fsB, savesDirB);
      expect(fsB.list().size).toBe(0);
    } finally {
      await rm(savesDirB, { recursive: true, force: true });
    }

    // Later, server A starts a fresh emulator with the same savesDir — it sees
    // its prior state again.
    const fsA2 = fakeFs();
    await restoreHostToMemfs(fsA2, savesDir);
    expect([...fsA2.readFile("/save.bin")]).toEqual([0xaa, 0xbb, 0xcc]);
    expect([...fsA2.readFile("/mp/controller-1.bin")]).toEqual([1, 2, 3, 4]);
  });
});

describe("savesDir host directory is created on first persist", () => {
  test("mkdir is recursive — nested paths land cleanly", async () => {
    const fs = fakeFs();
    fs.mkdir("/a");
    fs.mkdir("/a/b");
    fs.writeFile("/a/b/c.bin", new Uint8Array([7]));
    await persistMemfsToHost(fs, savesDir);
    const stats = await stat(path.join(savesDir, "a", "b"));
    expect(stats.isDirectory()).toBe(true);
    const c = await Bun.file(path.join(savesDir, "a", "b", "c.bin")).bytes();
    expect([...c]).toEqual([7]);
  });
});
