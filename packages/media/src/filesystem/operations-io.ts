import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  statfs,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import {
  FileOperationConflict,
  type MediaFileRoots,
  type FileOperationManifest,
} from "./operations-types.ts";
import { readFile } from "node:fs/promises";

export function validateMediaRoots(
  roots: MediaFileRoots,
  hasExclusionVerifier: boolean,
): void {
  for (const root of [roots.downloads, roots.library, roots.control]) {
    if (!nodePath.isAbsolute(root) || nodePath.resolve(root) === nodePath.sep)
      throw new Error("Explicit media root required");
  }
  const relation = nodePath.relative(
    nodePath.resolve(roots.library),
    nodePath.resolve(roots.control),
  );
  const inverse = nodePath.relative(
    nodePath.resolve(roots.control),
    nodePath.resolve(roots.library),
  );
  if (roots.controlPolicy === "plex-excluded") {
    if (relation !== ".media-control" || !hasExclusionVerifier)
      throw new Error(
        "Excluded control requires exact path and verified Plex exclusion",
      );
  } else if (!outside(relation) || !outside(inverse))
    throw new Error("Control and scanned library roots must be disjoint");
}

export async function requireCapacity(
  target: string,
  sizeBytes: number,
  minimumFreeBytes?: number,
): Promise<void> {
  const capacity = await statfs(nodePath.dirname(target));
  const available = capacity.bavail * capacity.bsize;
  const floor =
    minimumFreeBytes ??
    Math.max(20 * 1024 ** 3, capacity.blocks * capacity.bsize * 0.05);
  if (available < sizeBytes + floor)
    throw new FileOperationConflict("Insufficient destination capacity");
}

export async function saveManifest(
  path: string,
  manifest: FileOperationManifest,
  hooks?: ManifestSaveHooks,
): Promise<void> {
  const temporary = `${path}.tmp`;
  if (await exists(temporary)) await unlinkRegular(temporary);
  const handle = await open(temporary, "wx", 0o600);
  let installed: ManifestInstallation | undefined;
  try {
    await handle.writeFile(JSON.stringify(manifest));
    await handle.sync();
    if (hooks?.acknowledge !== undefined) {
      const info = await handle.stat({ bigint: true });
      installed = {
        device: info.dev.toString(),
        inode: info.ino.toString(),
        sizeBytes: info.size.toString(),
        mtimeNs: info.mtimeNs.toString(),
      };
    }
  } finally {
    await handle.close();
  }
  hooks?.beforeInstall?.();
  await rename(temporary, path);
  await syncDirectory(nodePath.dirname(path));
  if (hooks?.acknowledge !== undefined) {
    if (installed === undefined)
      throw new Error("Missing installed journal identity");
    await hooks.acknowledge(installed);
  }
}

export type ManifestInstallation = {
  device: string;
  inode: string;
  sizeBytes: string;
  mtimeNs: string;
};

export type ManifestSaveHooks = {
  beforeInstall?: () => void;
  acknowledge?: (installed: ManifestInstallation) => Promise<void>;
};

export async function verifyControlExclusion(
  roots: MediaFileRoots,
  verify?: (roots: MediaFileRoots) => Promise<void>,
): Promise<void> {
  if (roots.controlPolicy !== "plex-excluded") return;
  const rootMarker = await safePath(roots.library, ".plexignore", false);
  const controlMarker = await safePath(roots.control, ".plexignore", false);
  const rootText = await readFile(rootMarker, "utf8");
  const controlText = await readFile(controlMarker, "utf8");
  if (
    !rootText.split(/\r?\n/u).includes(".media-control/*") ||
    !controlText.split(/\r?\n/u).includes("*")
  )
    throw new FileOperationConflict(
      "Plex control exclusion markers are missing",
    );
  if (verify === undefined)
    throw new FileOperationConflict(
      "Plex control exclusion has not been verified",
    );
  await verify(roots);
}

export function outside(path: string): boolean {
  return (
    path === ".." ||
    path.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(path)
  );
}

export async function safePath(
  root: string,
  path: string,
  createParents: boolean,
): Promise<string> {
  if (
    path.length === 0 ||
    nodePath.isAbsolute(path) ||
    path.includes("\0") ||
    path
      .split(/[\\/]/u)
      .some((part) => part === ".." || part === "" || part === ".")
  )
    throw new FileOperationConflict("Invalid relative media path");
  const absoluteRoot = nodePath.resolve(root);
  if ((await realpath(absoluteRoot)) !== absoluteRoot)
    throw new FileOperationConflict(
      "Media root must not traverse symbolic links",
    );
  const target = nodePath.resolve(absoluteRoot, path);
  if (
    target === absoluteRoot ||
    outside(nodePath.relative(absoluteRoot, target))
  )
    throw new FileOperationConflict("Path escapes media root");
  let current = absoluteRoot;
  const parts = nodePath.relative(absoluteRoot, target).split(nodePath.sep);
  for (const [index, part] of parts.entries()) {
    current = nodePath.join(current, part);
    await checkPathComponent({
      path: current,
      parent: index < parts.length - 1,
      createParents,
    });
  }
  return target;
}

async function checkPathComponent(input: {
  path: string;
  parent: boolean;
  createParents: boolean;
}): Promise<void> {
  if (!(await exists(input.path))) {
    if (!input.parent) return;
    if (!input.createParents)
      throw new FileOperationConflict("Media source parent missing");
    try {
      await mkdir(input.path);
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
  }
  const info = await lstat(input.path);
  const valid = input.parent ? info.isDirectory() : info.isFile();
  if (!valid || info.isSymbolicLink())
    throw new FileOperationConflict("Unexpected media path type");
}

const SystemErrorSchema = z.object({ code: z.string() });
function hasCode(error: unknown, code: string): boolean {
  const result = SystemErrorSchema.safeParse(error);
  return result.success && result.data.code === code;
}
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}
export async function unlinkRegular(
  path: string,
  beforeEffect?: () => void,
): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile())
    throw new FileOperationConflict("Refusing to unlink a non-file");
  beforeEffect?.();
  await unlink(path);
}
export async function syncFile(
  path: string,
  assertActive?: () => void,
): Promise<void> {
  assertActive?.();
  const handle = await open(path, "r");
  try {
    assertActive?.();
    await handle.sync();
    assertActive?.();
  } finally {
    await handle.close();
    assertActive?.();
  }
}
/** Guarded callers retain the original invocation fence through open, sync and close. */
export async function syncDirectory(
  path: string,
  assertActive?: () => void,
): Promise<void> {
  await syncFile(path, assertActive);
}

export async function sha256File(
  path: string,
  checkpoint?: () => Promise<void>,
): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile())
    throw new FileOperationConflict("Expected a regular media file");
  const hash = createHash("sha256");
  const handle = await open(path, "r");
  const buffer = new Uint8Array(1024 * 1024);
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      await checkpoint?.();
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}
export async function copyExclusive(
  source: string,
  target: string,
  checkpoint: () => Promise<void>,
): Promise<void> {
  const input = await open(source, "r");
  try {
    const output = await open(target, "wx", 0o600);
    try {
      const buffer = new Uint8Array(1024 * 1024);
      for (;;) {
        await checkpoint();
        const { bytesRead } = await input.read(buffer);
        if (bytesRead === 0) break;
        await writeChunk(output, buffer.subarray(0, bytesRead));
      }
      await output.sync();
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

async function writeChunk(
  output: FileHandle,
  buffer: Uint8Array,
): Promise<void> {
  let written = 0;
  while (written < buffer.length) {
    const { bytesWritten } = await output.write(
      buffer,
      written,
      buffer.length - written,
    );
    if (bytesWritten === 0)
      throw new Error("Media staging write made no progress");
    written += bytesWritten;
  }
}
