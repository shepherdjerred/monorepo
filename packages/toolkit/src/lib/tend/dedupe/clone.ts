import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
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
  readonly nlink: number;
  readonly uid: number;
  readonly gid: number;
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
          nlink: info.nlink,
          uid: info.uid,
          gid: info.gid,
          atimeMs: info.atimeMs,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
        }
      : null;
  } catch {
    return null;
  }
}

export function isSameFile(
  left: FileIdentity | null,
  right: FileIdentity,
): boolean {
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

const TEMP_NAME_PATTERN = /^(\d+)-\d+$/u;
/** The staging directory while it is being made inside a worktree. */
const SEED_NAME_PREFIX = ".tend-dedupe-";
const SEED_NAME_PATTERN = /^\.tend-dedupe-(\d+)$/u;
let temporaryCounter = 0;

/**
 * Where a worktree's clones are made before they are renamed into place:
 * inside its own git directory. Nothing under a git directory is ever
 * reported by `git status` or staged by a blanket `git add`, so a session working
 * in the worktree never sees a half-finished clone.
 */
export function temporaryCloneDir(gitDir: string): string {
  return path.join(gitDir, "tend-dedupe");
}

/** The group of a directory, which is the group a file made in it gets. */
export async function directoryGroup(directory: string): Promise<number> {
  const info = await lstat(directory);
  return info.gid;
}

/**
 * What a run that died left in `directory`: names that fit `pattern`, whose
 * first group is the pid of a process that is gone.
 */
async function leftoversIn(
  directory: string,
  pattern: RegExp,
  isPidAlive: (pid: number) => boolean,
): Promise<string[]> {
  const leftovers: string[] = [];
  for (const name of await readdir(directory)) {
    const ownerPid = Number(pattern.exec(name)?.[1]);
    if (
      Number.isSafeInteger(ownerPid) &&
      ownerPid !== process.pid &&
      !isPidAlive(ownerPid)
    ) {
      leftovers.push(path.join(directory, name));
    }
  }
  return leftovers;
}

/**
 * Put an empty directory at `directory` that carries the worktree's group.
 *
 * A file takes the group of the directory it is made in, and a directory
 * keeps the group it was made with wherever it is moved. A git directory
 * need not be in the worktree's group: a worktree under `/tmp` is in group
 * `wheel` while its git directory, under the home directory, is in `staff`.
 * `chown` cannot fix that, since it only gives a file to a group the user
 * belongs to. So the directory is made inside the worktree, where it gets
 * the right group, and moved into the git directory before anything is
 * cloned into it. It is empty the whole time it is in the worktree, and git
 * does not report empty directories.
 */
async function adoptWorktreeGroup(
  directory: string,
  worktreePath: string,
  isPidAlive: (pid: number) => boolean,
): Promise<void> {
  const worktree = await lstat(worktreePath);
  for (const dead of await leftoversIn(
    worktreePath,
    SEED_NAME_PATTERN,
    isPidAlive,
  )) {
    // Only ever an empty directory; anything else is not this tool's.
    await rmdir(dead).catch(() => null);
  }
  const seed = path.join(
    worktreePath,
    `${SEED_NAME_PREFIX}${String(process.pid)}`,
  );
  await mkdir(seed);
  try {
    // Replaces the empty directory already there.
    await rename(seed, directory);
  } catch {
    // Left as it was: the files there are then counted as not replaceable.
    await rmdir(seed);
  } finally {
    await utimes(
      worktreePath,
      worktree.atimeMs / 1000,
      worktree.mtimeMs / 1000,
    );
  }
}

/**
 * Create the directory and remove clones left by a run that died between
 * cloning and renaming; a file owned by a live pid is another run's. The
 * directory is made to carry the worktree's group, so that a clone staged
 * in it is in the group of the file it replaces. Returns the group it has.
 */
export async function prepareTemporaryCloneDir(options: {
  readonly directory: string;
  readonly worktreePath: string;
  readonly isPidAlive: (pid: number) => boolean;
}): Promise<number> {
  const { directory, worktreePath, isPidAlive } = options;
  await mkdir(directory, { recursive: true });
  for (const dead of await leftoversIn(
    directory,
    TEMP_NAME_PATTERN,
    isPidAlive,
  )) {
    await rm(dead, { force: true });
  }
  const wanted = await directoryGroup(worktreePath);
  const leftover = await readdir(directory);
  if ((await directoryGroup(directory)) !== wanted && leftover.length === 0) {
    await adoptWorktreeGroup(directory, worktreePath, isPidAlive);
  }
  return directoryGroup(directory);
}

/** Leave no trace in the git directory once a worktree is done. */
export async function removeTemporaryCloneDirIfEmpty(
  directory: string,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  if (names.length === 0) {
    await rmdir(directory);
  }
}

/** Device a directory is on; `null` when it is missing or not a directory. */
export async function directoryDevice(
  directory: string,
): Promise<number | null> {
  try {
    const info = await lstat(directory);
    return info.isDirectory() ? info.dev : null;
  } catch {
    return null;
  }
}

function errorCode(error: unknown): string | undefined {
  const parsed = z.looseObject({ code: z.string() }).safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type ReplaceOutcome =
  | {
      readonly kind: "replaced";
      readonly ino: number;
      readonly size: number;
      /** As the file is once every step here is done; any later write moves it. */
      readonly ctimeMs: number;
    }
  /** The target or the source changed after it was checked; nothing was done. */
  | { readonly kind: "changed" }
  /** The clone would not have the target's size, owner or group. */
  | { readonly kind: "unfit" }
  | { readonly kind: "unsupported"; readonly detail: string }
  | { readonly kind: "failed"; readonly detail: string };

/**
 * Replace `targetPath` with a clone of `sourcePath`, which holds the same
 * bytes. The clone is made in `temporaryDir` and renamed over the target, so
 * a reader sees the old file or the new one and never a partial one, and the
 * working tree never holds an extra file.
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
  /** A directory on the target's volume that git does not look into. */
  readonly temporaryDir: string;
  readonly cloneFile: CloneFile;
}): Promise<ReplaceOutcome> {
  const { sourcePath, targetPath, source, target } = options;
  const directory = path.dirname(targetPath);
  temporaryCounter += 1;
  const temporaryPath = path.join(
    options.temporaryDir,
    `${String(process.pid)}-${String(temporaryCounter)}`,
  );
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
    if (!isSameFile(await lstatRegularFile(sourcePath), source)) {
      return { kind: "changed" };
    }
    const permissions = target.mode & 0o7777;
    await chmod(temporaryPath, permissions);
    await utimes(temporaryPath, target.atimeMs / 1000, target.mtimeMs / 1000);
    // What is about to take the target's place must be its equal in
    // everything a rename cannot fix afterwards.
    const staged = await lstatRegularFile(temporaryPath);
    if (
      staged?.size !== target.size ||
      staged.uid !== target.uid ||
      staged.gid !== target.gid
    ) {
      return { kind: "unfit" };
    }
    if (!isSameFile(await lstatRegularFile(targetPath), target)) {
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
      : {
          kind: "replaced",
          ino: replaced.ino,
          size: replaced.size,
          ctimeMs: replaced.ctimeMs,
        };
  } catch (error: unknown) {
    return { kind: "failed", detail: errorText(error) };
  } finally {
    // Gone already when the rename happened.
    await rm(temporaryPath, { force: true });
  }
}
