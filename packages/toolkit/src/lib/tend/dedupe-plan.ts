import path from "node:path";
import {
  type CloneFile,
  type FileIdentity,
  lstatRegularFile,
  prepareTemporaryCloneDir,
  removeTemporaryCloneDirIfEmpty,
  replaceWithClone,
  temporaryCloneDir,
} from "./dedupe-clone.ts";
import {
  type DedupeFileRecord,
  readDedupeState,
  writeDedupeState,
} from "./dedupe-state.ts";
import type { CommandRunner } from "./types.ts";
import { readWorktreeStatus } from "./worktrees-status.ts";

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
};

/**
 * What `git status` says is not the committed content, read once per
 * worktree and only when a file there is about to be used.
 */
type CleanCheck =
  | {
      readonly ok: true;
      /** Taken before status ran: a file untouched since then is as reported. */
      readonly startedMs: number;
      readonly changed: ReadonlySet<string>;
    }
  | { readonly ok: false; readonly reason: string };

/** Where a worktree's clones are staged, and the volume that is on. */
type TemporaryPlace = {
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

/** The copy every later holder of the same index entry is cloned from. */
type CanonicalCopy = {
  readonly worktree: DedupeWorktree;
  /** `undefined` until looked at; `null` when it is not a usable file. */
  file?: FileIdentity | null | undefined;
};

/**
 * Canonical copies for one repository, keyed by the `git ls-files -s` line
 * (mode, blob, path), so equal keys mean equal committed content at the same
 * path. Worktrees are added main checkout first.
 */
export type DedupeRegistry = Map<string, CanonicalCopy>;

type IndexEntry = { readonly sha: string; readonly path: string };

/**
 * `H <mode> <sha> <stage>\t<path>` from `git ls-files -s -v`. Only a plain
 * cached entry (`H`) for a regular file at stage 0 qualifies: `git status`
 * does not report changes to assume-unchanged or skip-worktree entries, so
 * their content cannot be vouched for.
 */
function parseIndexLine(line: string): IndexEntry | null {
  const tab = line.indexOf("\t");
  if (tab === -1 || !line.startsWith("H 100") || line[tab - 1] !== "0") {
    return null;
  }
  const mode = line.slice(2, 8);
  return mode === "100644" || mode === "100755"
    ? { sha: line.slice(9, tab - 2), path: line.slice(tab + 1) }
    : null;
}

function cleanCheck(
  wt: DedupeWorktree,
  ctx: DedupeContext,
): Promise<CleanCheck> {
  wt.clean ??= (async (): Promise<CleanCheck> => {
    const startedMs = Date.now();
    const status = await readWorktreeStatus(wt.path, ctx.runner);
    if (status.kind === "timeout") {
      return { ok: false, reason: "git status timed out" };
    }
    if (status.kind === "failed") {
      return { ok: false, reason: `git status failed: ${status.detail}` };
    }
    return {
      ok: true,
      startedMs,
      changed: new Set(status.kind === "dirty" ? status.paths : []),
    };
  })();
  return wt.clean;
}

/**
 * The worktree's staging directory, made ready on first use. A dry run only
 * asks which volume the git directory is on and creates nothing.
 */
function temporaryPlace(
  wt: DedupeWorktree,
  ctx: DedupeContext,
): Promise<TemporaryPlace> {
  wt.temporary ??= (async (): Promise<TemporaryPlace> => {
    const dir = temporaryCloneDir(wt.gitDir);
    if (!ctx.apply) {
      return { dir, dev: await ctx.deviceOf(wt.gitDir) };
    }
    try {
      await prepareTemporaryCloneDir(dir, ctx.isPidAlive);
    } catch {
      return { dir, dev: null };
    }
    return { dir, dev: await ctx.deviceOf(dir) };
  })();
  return wt.temporary;
}

/** True when `file` is the committed content `check` vouches for. */
function isVouchedFor(
  check: CleanCheck,
  relativePath: string,
  file: FileIdentity,
): boolean {
  return (
    check.ok &&
    !check.changed.has(relativePath) &&
    file.ctimeMs < check.startedMs
  );
}

type Verdict =
  | { readonly kind: "skip" }
  | { readonly kind: "already-shared" }
  /** The canonical copy cannot be used; this worktree's becomes canonical. */
  | { readonly kind: "promote"; readonly file: FileIdentity }
  | { readonly kind: "abort"; readonly reason: string }
  | {
      readonly kind: "replace";
      readonly sourcePath: string;
      readonly targetPath: string;
      readonly source: FileIdentity;
      readonly target: FileIdentity;
      readonly temporaryDir: string;
    };

async function judgeCandidate(options: {
  readonly wt: DedupeWorktree;
  readonly entry: IndexEntry;
  readonly canonical: CanonicalCopy;
  readonly recorded: DedupeFileRecord | undefined;
  readonly ctx: DedupeContext;
}): Promise<Verdict> {
  const { wt, entry, canonical, recorded, ctx } = options;
  const sourcePath = path.join(canonical.worktree.path, entry.path);
  if (canonical.file === undefined) {
    canonical.file = await lstatRegularFile(sourcePath);
  }
  const source = canonical.file;
  if (source !== null && source.size < ctx.minSizeBytes) {
    return { kind: "skip" };
  }
  const targetPath = path.join(wt.path, entry.path);
  const target = await lstatRegularFile(targetPath);
  if (target === null) {
    return { kind: "skip" };
  }
  if (source === null) {
    return { kind: "promote", file: target };
  }
  if (
    target.size !== source.size ||
    target.dev !== source.dev ||
    target.ino === source.ino ||
    ctx.unsupportedDevices.has(target.dev)
  ) {
    return { kind: "skip" };
  }
  if (
    recorded?.sha === entry.sha &&
    recorded.ino === target.ino &&
    recorded.size === target.size
  ) {
    return { kind: "already-shared" };
  }
  // A rename is only atomic within one volume, so the staging directory has
  // to be on the volume the file is on. There is no second place to stage.
  const place = await temporaryPlace(wt, ctx);
  if (place.dev !== target.dev) {
    return {
      kind: "abort",
      reason:
        place.dev === null
          ? `${place.dir} cannot be used to stage clones`
          : `its git directory is on a different volume than ${entry.path}, so a clone cannot be renamed into place`,
    };
  }
  const targetCheck = await cleanCheck(wt, ctx);
  if (!targetCheck.ok) {
    return { kind: "abort", reason: targetCheck.reason };
  }
  if (!isVouchedFor(targetCheck, entry.path, target)) {
    return { kind: "skip" };
  }
  const sourceCheck = await cleanCheck(canonical.worktree, ctx);
  return isVouchedFor(sourceCheck, entry.path, source)
    ? {
        kind: "replace",
        sourcePath,
        targetPath,
        source,
        target,
        temporaryDir: place.dir,
      }
    : { kind: "promote", file: target };
}

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
  refresh: DedupeRefresh;
  readonly warnings: string[];
};

async function applyReplacement(
  verdict: Extract<Verdict, { kind: "replace" }>,
  result: DedupePassResult,
  ctx: DedupeContext,
): Promise<{ readonly ino: number; readonly size: number } | null> {
  const outcome = await replaceWithClone({
    sourcePath: verdict.sourcePath,
    targetPath: verdict.targetPath,
    source: verdict.source,
    target: verdict.target,
    temporaryDir: verdict.temporaryDir,
    cloneFile: ctx.cloneFile,
  });
  switch (outcome.kind) {
    case "replaced":
      result.replacedFiles += 1;
      result.replacedBytes += outcome.size;
      return { ino: outcome.ino, size: outcome.size };
    case "changed":
      result.changedFiles += 1;
      return null;
    case "unsupported":
      // Not a per-file problem: nothing on this device can be cloned.
      ctx.unsupportedDevices.set(verdict.target.dev, outcome.detail);
      result.plannedFiles -= 1;
      result.plannedBytes -= verdict.target.size;
      return null;
    case "failed":
      result.failedFiles += 1;
      result.firstFailure ??= `${verdict.targetPath}: ${outcome.detail}`;
      return null;
  }
}

/**
 * Replaced files have new inodes, so git sees them as possibly changed until
 * it re-reads them. Refreshing here keeps the next interactive `git status`
 * fast, but it holds `index.lock` while it hashes, and a `git add` or
 * `git commit` in that worktree would fail meanwhile. A worktree someone is
 * using is therefore left to refresh itself on its own next `git status`.
 */
function plannedRefresh(
  wt: DedupeWorktree,
  ctx: DedupeContext,
): "refreshed" | "live" | "disabled" {
  if (!ctx.refreshIndex) {
    return "disabled";
  }
  return wt.liveReason === undefined ? "refreshed" : "live";
}

async function finishWorktree(
  wt: DedupeWorktree,
  state: ReadonlyMap<string, DedupeFileRecord>,
  result: DedupePassResult,
  ctx: DedupeContext,
): Promise<void> {
  if (result.replacedFiles > 0) {
    result.refresh = plannedRefresh(wt, ctx);
  }
  if (result.refresh === "refreshed") {
    const refreshed = await ctx.runner(
      ["git", "-c", "core.fsmonitor=false", "update-index", "-q", "--refresh"],
      { cwd: wt.path, timeoutMs: 600_000 },
    );
    if (refreshed.exitCode !== 0) {
      result.refresh = "failed";
      result.warnings.push(
        `git update-index --refresh did not finish in ${wt.path} (exit ${String(refreshed.exitCode)}, usually a held index.lock); the next git status there refreshes it`,
      );
    }
  }
  await writeDedupeState(ctx.stateDir, wt.path, state);
}

type PassState = {
  readonly wt: DedupeWorktree;
  readonly registry: DedupeRegistry;
  readonly ctx: DedupeContext;
  readonly state: Map<string, DedupeFileRecord>;
  readonly result: DedupePassResult;
  stateChanged: boolean;
};

/**
 * Claim an entry nobody holds yet, or return the canonical copy this
 * worktree's file should be weighed against. Nearly every entry is settled
 * here, without an await.
 */
function claimOrFindCanonical(
  line: string,
  entry: IndexEntry,
  pass: PassState,
): CanonicalCopy | null {
  const canonical = pass.registry.get(line);
  if (canonical === undefined) {
    // `line` is a slice of this worktree's whole `ls-files` output. Keeping
    // the slice as a key would keep megabytes alive per worktree for the
    // sake of a few entries, so the key is copied out.
    pass.registry.set(Buffer.from(line).toString(), { worktree: pass.wt });
    return null;
  }
  if (!pass.wt.isTarget || canonical.worktree === pass.wt) {
    return null;
  }
  const known = canonical.file;
  const tooSmall =
    known !== undefined && known !== null && known.size < pass.ctx.minSizeBytes;
  return tooSmall && !pass.state.has(entry.path) ? null : canonical;
}

/** Returns false when the rest of the worktree must be left alone. */
async function settleCandidate(
  line: string,
  entry: IndexEntry,
  canonical: CanonicalCopy,
  pass: PassState,
): Promise<boolean> {
  const { wt, ctx, state, result } = pass;
  const recorded = state.get(entry.path);
  const verdict = await judgeCandidate({ wt, entry, canonical, recorded, ctx });
  if (verdict.kind === "abort") {
    result.warnings.push(`Skipped ${wt.path}: ${verdict.reason}`);
    return false;
  }
  if (verdict.kind === "already-shared") {
    return true;
  }
  if (recorded !== undefined) {
    state.delete(entry.path);
    pass.stateChanged = true;
  }
  if (verdict.kind === "promote") {
    pass.registry.set(line, { worktree: wt, file: verdict.file });
  }
  if (verdict.kind !== "replace") {
    return true;
  }
  result.plannedFiles += 1;
  result.plannedBytes += verdict.target.size;
  const replaced = ctx.apply
    ? await applyReplacement(verdict, result, ctx)
    : null;
  if (replaced !== null) {
    state.set(entry.path, {
      ino: replaced.ino,
      size: replaced.size,
      sha: entry.sha,
    });
    pass.stateChanged = true;
  }
  return true;
}

/**
 * Read one worktree's index. Entries nobody has claimed yet make this
 * worktree their canonical copy; every other entry of a target worktree is
 * weighed against the canonical copy and, when applying, replaced by a clone
 * of it.
 */
export async function dedupeWorktreePass(
  wt: DedupeWorktree,
  registry: DedupeRegistry,
  ctx: DedupeContext,
): Promise<DedupePassResult> {
  const result: DedupePassResult = {
    plannedFiles: 0,
    plannedBytes: 0,
    replacedFiles: 0,
    replacedBytes: 0,
    changedFiles: 0,
    failedFiles: 0,
    refresh: "not-needed",
    warnings: [],
  };
  const listed = await ctx.runner(["git", "ls-files", "-s", "-v", "-z"], {
    cwd: wt.path,
    timeoutMs: 60_000,
  });
  if (listed.exitCode !== 0) {
    result.warnings.push(
      `git ls-files failed in ${wt.path}: ${listed.stderr.trim() || `exit ${String(listed.exitCode)}`}`,
    );
    return result;
  }
  const pass: PassState = {
    wt,
    registry,
    ctx,
    state: wt.isTarget
      ? await readDedupeState(ctx.stateDir, wt.path)
      : new Map<string, DedupeFileRecord>(),
    result,
    stateChanged: false,
  };

  for (const line of listed.stdout.split("\0")) {
    const entry = parseIndexLine(line);
    const canonical =
      entry === null ? null : claimOrFindCanonical(line, entry, pass);
    if (entry === null || canonical === null) {
      continue;
    }
    if (!(await settleCandidate(line, entry, canonical, pass))) {
      break;
    }
  }

  if (wt.temporary !== undefined && ctx.apply) {
    const place = await wt.temporary;
    await removeTemporaryCloneDirIfEmpty(place.dir);
  }
  if (pass.stateChanged && ctx.apply) {
    await finishWorktree(wt, pass.state, result, ctx);
  } else if (!ctx.apply && result.plannedFiles > 0) {
    result.refresh = plannedRefresh(wt, ctx);
  }
  return result;
}
