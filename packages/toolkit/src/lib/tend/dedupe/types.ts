import type { CloneFile, FileIdentity } from "./clone.ts";
import type { CommandRunner } from "#lib/tend/types.ts";

export type DedupeContext = {
  readonly runner: CommandRunner;
  readonly apply: boolean;
  readonly minSizeBytes: number;
  readonly stateDir: string;
  readonly cloneFile: CloneFile;
  /** `false` leaves every index alone (`--no-refresh`). */
  readonly refreshIndex: boolean;
  readonly isPidAlive: (pid: number) => boolean;
  /** Device a directory is on, or `null` when it is not a directory. */
  readonly deviceOf: (directory: string) => Promise<number | null>;
  /** Devices where a clone was refused, with the refusal. */
  readonly unsupportedDevices: Map<number, string>;
  /** Size of each blob seen so far, by object name. */
  readonly blobSizes: Map<string, number>;
  /** The user this run acts as; another user's file is not replaced. */
  readonly currentUid: number;
  /** The one look at open files a dry run takes. */
  readonly dryRunOpenFiles: {
    snapshot?: Promise<Set<string> | null> | undefined;
  };
};

/**
 * What `git status` says is not the committed content, read once per
 * worktree and only when a file there is about to be replaced.
 */
export type CleanCheck =
  | {
      readonly ok: true;
      /** Taken before status ran: a file untouched since then is as reported. */
      readonly startedMs: number;
      readonly changed: ReadonlySet<string>;
    }
  | { readonly ok: false; readonly reason: string };

/** Where a worktree's clones are staged, and the volume that is on. */
export type TemporaryPlace = {
  readonly dir: string;
  readonly dev: number | null;
};

export type DedupeWorktree = {
  readonly path: string;
  /** Files here may be replaced; otherwise the worktree only lends its own. */
  readonly isTarget: boolean;
  /** The worktree's own git directory, where its clones are staged. */
  readonly gitDir: string;
  /** What marks the worktree as in use right now, if anything does. */
  readonly liveReason?: string | undefined;
  temporary?: Promise<TemporaryPlace> | undefined;
  clean?: Promise<CleanCheck> | undefined;
};

/**
 * Whether a canonical copy may be cloned from. Its worktree's index was read
 * earlier in the run, possibly minutes ago, so before the copy is used it is
 * checked against the entry it stands for.
 */
export type SourceCheck =
  /** The file is the registered blob; `file` is the file that was hashed. */
  | { readonly state: "ok"; readonly file: FileIdentity }
  /** The file or its index entry is no longer what was registered. */
  | { readonly state: "stale" }
  /** Filtered or line-ending converted: its bytes need not be the blob's. */
  | { readonly state: "unproven" }
  /** It has file flags or extended attributes a clone would spread. */
  | { readonly state: "protected" };

/** The copy every later holder of the same index entry is cloned from. */
export type CanonicalCopy = {
  readonly worktree: DedupeWorktree;
  /**
   * A first look at the file, used only to pass over small files quickly:
   * `undefined` until looked at, `null` when it is not a regular file.
   */
  seen?: FileIdentity | null | undefined;
  verified?: SourceCheck | undefined;
};

/**
 * Canonical copies for one repository, keyed by the `git ls-files -s -v`
 * line (flags, mode, blob, path), so equal keys mean equal committed content
 * at the same path. Worktrees are added main checkout first.
 */
export type DedupeRegistry = Map<string, CanonicalCopy>;

export type IndexEntry = { readonly sha: string; readonly path: string };

/** A target file that passed every check made on its own worktree. */
export type PendingReplacement = {
  /** The `ls-files` line both worktrees listed for the path. */
  readonly line: string;
  readonly entry: IndexEntry;
  readonly canonical: CanonicalCopy;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly target: FileIdentity;
  readonly temporaryDir: string;
};

/**
 * What became of the index after files were replaced. `refreshed` and
 * `failed` are outcomes; in a dry run `refreshed` means it would be.
 */
export type DedupeRefresh =
  "not-needed" | "refreshed" | "live" | "disabled" | "failed";

export type DedupePassResult = {
  /** Files that qualify: replaced in an applied run, counted in a dry run. */
  plannedFiles: number;
  plannedBytes: number;
  replacedFiles: number;
  replacedBytes: number;
  /** Changed between the check and the rename, so left alone. */
  changedFiles: number;
  failedFiles: number;
  firstFailure?: string | undefined;
  /**
   * Left alone: the path is filtered, or the file is not as long as its blob
   * (line endings converted), so equal blobs do not prove equal bytes.
   */
  normalizedOrFilteredFiles: number;
  /**
   * Left alone: open in a process, hard-linked elsewhere, another user's, or
   * carrying file flags or extended attributes of its own.
   */
  protectedFiles: number;
  /** Left alone: the copy to clone from was no longer the listed blob. */
  staleSourceFiles: number;
  refresh: DedupeRefresh;
  readonly warnings: string[];
};
