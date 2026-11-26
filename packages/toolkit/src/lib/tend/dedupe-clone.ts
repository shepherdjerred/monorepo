import {
  chmod,
  constants,
  copyFile,
  lstat,
  rename,
  rm,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** What `lstat` says about a regular file, kept to detect any later change. */
export type FileIdentity = {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mode: number;
  readonly atimeMs: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
};

/** `null` when the path is missing or is not a regular file. */
export async function lstatRegularFile(
  filePath: string,
): Promise<FileIdentity | null> {
  try {
    const info = await lstat(filePath);
    return info.isFile()
      ? {
          dev: info.dev,
          ino: info.ino,
          size: info.size,
          mode: info.mode,
          atimeMs: info.atimeMs,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
        }
      : null;
  } catch {
    return null;
  }
}

function sameFile(left: FileIdentity | null, right: FileIdentity): boolean {
  return (
    left !== null &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/** Copies `source` to a new file at `destination`. */
export type CloneFile = (source: string, destination: string) => Promise<void>;

/**
 * A copy-on-write clone: the new file shares the source's blocks until one of
 * them is written. `COPYFILE_FICLONE_FORCE` fails instead of copying the
 * bytes where the filesystem cannot clone, so this never duplicates data.
 */
export const cloneFileCopyOnWrite: CloneFile = (source, destination) =>
  copyFile(source, destination, constants.COPYFILE_FICLONE_FORCE);

const CLONE_UNSUPPORTED_CODES = new Set([
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSYS",
  "EXDEV",
]);

const TEMP_MARKER = ".tend-dedupe-";
const TEMP_NAME_PATTERN = /\.tend-dedupe-(\d+)-\d+$/u;
let temporaryCounter = 0;

/**
 * The pid of the run that left `filePath` behind as a clone it never renamed
 * into place, or `null` when the name is not one of ours.
 */
export function temporaryCloneOwnerPid(filePath: string): number | null {
  const pid = TEMP_NAME_PATTERN.exec(filePath)?.[1];
  return pid === undefined ? null : Number(pid);
}

function errorCode(error: unknown): string | undefined {
  const parsed = z.looseObject({ code: z.string() }).safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ReplaceOutcome =
  | { readonly kind: "replaced"; readonly ino: number; readonly size: number }
  /** The target or the source changed after it was checked; nothing was done. */
  | { readonly kind: "changed" }
  | { readonly kind: "unsupported"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

/**
 * Replace `targetPath` with a clone of `sourcePath`, which holds the same
 * bytes. The clone is made beside the target and renamed over it, so a reader
 * sees the old file or the new one and never a partial one.
 *
 * Nothing about the target is allowed to look different afterwards except
 * its inode: permissions and times are carried over, and the directory's
 * times are put back, because both the reaper and build tools read directory
 * mtimes as activity. The rename only happens if neither file changed since
 * `target` and `source` were read.
 */
export async function replaceWithClone(options: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly source: FileIdentity;
  readonly target: FileIdentity;
  readonly cloneFile: CloneFile;
}): Promise<ReplaceOutcome> {
  const { sourcePath, targetPath, source, target } = options;
  const directory = path.dirname(targetPath);
  temporaryCounter += 1;
  const temporaryPath = `${targetPath}${TEMP_MARKER}${String(process.pid)}-${String(temporaryCounter)}`;
  try {
    const directoryBefore = await lstat(directory);
    try {
      await options.cloneFile(sourcePath, temporaryPath);
    } catch (error: unknown) {
      return CLONE_UNSUPPORTED_CODES.has(errorCode(error) ?? "")
        ? { kind: "unsupported", detail: errorText(error) }
        : { kind: "failed", detail: errorText(error) };
    }
    // The clone is a snapshot; it is the checked content only if the source
    // is still the file that was checked.
    if (!sameFile(await lstatRegularFile(sourcePath), source)) {
      return { kind: "changed" };
    }
    const permissions = target.mode & 0o7777;
    await chmod(temporaryPath, permissions);
    await utimes(temporaryPath, target.atimeMs / 1000, target.mtimeMs / 1000);
    if (!sameFile(await lstatRegularFile(targetPath), target)) {
      return { kind: "changed" };
    }
    await rename(temporaryPath, targetPath);
    await utimes(
      directory,
      directoryBefore.atimeMs / 1000,
      directoryBefore.mtimeMs / 1000,
    );
    const replaced = await lstatRegularFile(targetPath);
    return replaced === null
      ? { kind: "failed", detail: `${targetPath} vanished after the rename` }
      : { kind: "replaced", ino: replaced.ino, size: replaced.size };
  } catch (error: unknown) {
    return { kind: "failed", detail: errorText(error) };
  } finally {
    // Gone already when the rename happened.
    await rm(temporaryPath, { force: true });
  }
}
