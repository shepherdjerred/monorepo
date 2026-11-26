import path from "node:path";
import {
  type FileIdentity,
  lstatRegularFile,
  prepareTemporaryCloneDir,
  removeTemporaryCloneDirIfEmpty,
  replaceWithClone,
  temporaryCloneDir,
} from "./clone.ts";
import {
  type DedupeFileRecord,
  readDedupeState,
  writeDedupeState,
} from "./state.ts";
import type {
  CanonicalCopy,
  CleanCheck,
  DedupeContext,
  DedupePassResult,
  DedupeRegistry,
  DedupeWorktree,
  IndexEntry,
  PendingReplacement,
  TemporaryPlace,
} from "./types.ts";
import {
  confirmTargets,
  parseIndexLine,
  verifyCanonicalCopies,
} from "./verify.ts";
import { readWorktreeStatus } from "#lib/tend/worktrees-status.ts";

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

type PassState = {
  readonly wt: DedupeWorktree;
  readonly registry: DedupeRegistry;
  readonly ctx: DedupeContext;
  readonly state: Map<string, DedupeFileRecord>;
  readonly result: DedupePassResult;
  /** Taken before the index was listed. */
  readonly listedMs: number;
  stateChanged: boolean;
};

type Verdict =
  | { readonly kind: "skip" }
  | { readonly kind: "already-shared" }
  /** There is no canonical file; this worktree's copy takes its place. */
  | { readonly kind: "promote"; readonly size: number }
  | { readonly kind: "abort"; readonly reason: string }
  | { readonly kind: "pending"; readonly item: PendingReplacement };

/**
 * True when the target file is the content its listed index entry names:
 * `git status` does not report it changed, and it has not been touched since
 * before the index was listed, so neither a checkout nor an edit can have
 * slipped in between the listing and the status.
 */
function isVouchedFor(
  check: CleanCheck,
  relativePath: string,
  file: FileIdentity,
  listedMs: number,
): boolean {
  return (
    check.ok &&
    !check.changed.has(relativePath) &&
    file.ctimeMs < Math.min(check.startedMs, listedMs)
  );
}

/** Weigh one target file against everything its own worktree can say. */
async function judgeTarget(
  line: string,
  entry: IndexEntry,
  canonical: CanonicalCopy,
  pass: PassState,
): Promise<Verdict> {
  const { wt, ctx } = pass;
  const sourcePath = path.join(canonical.worktree.path, entry.path);
  if (canonical.seen === undefined) {
    canonical.seen = await lstatRegularFile(sourcePath);
  }
  const seen = canonical.seen;
  if (seen !== null && seen.size < ctx.minSizeBytes) {
    return { kind: "skip" };
  }
  const targetPath = path.join(wt.path, entry.path);
  const target = await lstatRegularFile(targetPath);
  if (target === null || ctx.unsupportedDevices.has(target.dev)) {
    return { kind: "skip" };
  }
  if (seen === null) {
    return { kind: "promote", size: target.size };
  }
  const recorded = pass.state.get(entry.path);
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
  return isVouchedFor(targetCheck, entry.path, target, pass.listedMs)
    ? {
        kind: "pending",
        item: {
          line,
          entry,
          canonical,
          sourcePath,
          targetPath,
          target,
          temporaryDir: place.dir,
        },
      }
    : { kind: "skip" };
}

async function applyReplacement(
  verdict: PendingReplacement & { readonly source: FileIdentity },
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
  const { seen } = canonical;
  const tooSmall =
    seen !== undefined && seen !== null && seen.size < pass.ctx.minSizeBytes;
  return tooSmall && !pass.state.has(entry.path) ? null : canonical;
}

/**
 * Make this worktree's copy the canonical one for later worktrees. It is not
 * trusted for that: like every canonical copy it is verified when first used.
 */
function promote(line: string, pass: PassState): void {
  pass.registry.set(line, { worktree: pass.wt });
}

/**
 * Collect the worktree's candidates. Returns `null` when the worktree must
 * be left alone altogether.
 */
async function collectCandidates(
  listing: string,
  pass: PassState,
): Promise<PendingReplacement[] | null> {
  const pending: PendingReplacement[] = [];
  for (const line of listing.split("\0")) {
    const entry = parseIndexLine(line);
    const canonical =
      entry === null ? null : claimOrFindCanonical(line, entry, pass);
    if (entry === null || canonical === null) {
      continue;
    }
    const verdict = await judgeTarget(line, entry, canonical, pass);
    if (verdict.kind === "abort") {
      pass.result.warnings.push(`Skipped ${pass.wt.path}: ${verdict.reason}`);
      return null;
    }
    if (verdict.kind === "already-shared") {
      continue;
    }
    // Whatever was recorded for the path no longer describes it.
    pass.stateChanged = pass.state.delete(entry.path) || pass.stateChanged;
    if (verdict.kind === "pending") {
      pending.push(verdict.item);
    } else if (verdict.kind === "promote") {
      promote(line, pass);
      pass.result.staleSourceFiles +=
        verdict.size >= pass.ctx.minSizeBytes ? 1 : 0;
    }
  }
  return pending;
}

/** Replace one confirmed target, or count why it is left alone. */
async function settleReplacement(
  item: PendingReplacement,
  pass: PassState,
): Promise<void> {
  const { ctx, state, result } = pass;
  const check = item.canonical.verified;
  if (check === undefined || check.state === "stale") {
    result.staleSourceFiles += 1;
    promote(item.line, pass);
    return;
  }
  if (check.state === "filtered") {
    result.filteredFiles += 1;
    return;
  }
  const { file: source } = check;
  if (
    item.target.size !== source.size ||
    item.target.dev !== source.dev ||
    item.target.ino === source.ino ||
    ctx.unsupportedDevices.has(item.target.dev)
  ) {
    return;
  }
  result.plannedFiles += 1;
  result.plannedBytes += item.target.size;
  const replaced = ctx.apply
    ? await applyReplacement({ ...item, source }, result, ctx)
    : null;
  if (replaced !== null) {
    state.set(item.entry.path, {
      ino: replaced.ino,
      size: replaced.size,
      sha: item.entry.sha,
    });
    pass.stateChanged = true;
  }
}

/**
 * Read one worktree's index. Entries nobody has claimed yet make this
 * worktree their canonical copy. Every other entry of a target worktree is
 * weighed against what its own worktree can vouch for, then against the
 * canonical copy, which is verified to still be that blob before, when
 * applying, the file is replaced by a clone of it.
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
    filteredFiles: 0,
    staleSourceFiles: 0,
    refresh: "not-needed",
    warnings: [],
  };
  const listedMs = Date.now();
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
    listedMs,
    stateChanged: false,
  };

  const candidates = await collectCandidates(listed.stdout, pass);
  const confirmed = await confirmTargets(wt, candidates ?? [], result, ctx);
  await verifyCanonicalCopies(confirmed, ctx);
  for (const item of confirmed) {
    await settleReplacement(item, pass);
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
