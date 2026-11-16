import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CommandRunner } from "./types.ts";

export type WorktreePorcelainEntry = {
  readonly path: string;
  readonly headSha: string;
  readonly branch?: string | undefined;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
};

export type RepoPrRecord = {
  readonly headRefName: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly updatedAtMs: number;
  readonly headRefOid?: string | undefined;
};

const GhPrRowSchema = z.looseObject({
  headRefName: z.string(),
  state: z.enum(["OPEN", "MERGED", "CLOSED"]),
  updatedAt: z.string(),
  headRefOid: z.string().optional(),
});

const GhPrListSchema = z.array(GhPrRowSchema);

function parseSinglePorcelainBlock(
  block: string,
): WorktreePorcelainEntry | null {
  let wtPath: string | undefined;
  let headSha = "";
  let branch: string | undefined;
  let detached = false;
  let locked = false;
  let prunable = false;

  for (const rawLine of block.split(/\r?\n/u)) {
    if (rawLine.startsWith("worktree ")) {
      wtPath = rawLine.slice("worktree ".length).trim();
    } else if (rawLine.startsWith("HEAD ")) {
      headSha = rawLine.slice("HEAD ".length).trim();
    } else if (rawLine.startsWith("branch refs/heads/")) {
      branch = rawLine.slice("branch refs/heads/".length).trim();
    } else if (rawLine === "detached") {
      detached = true;
    } else if (rawLine === "locked" || rawLine.startsWith("locked ")) {
      locked = true;
    } else if (rawLine === "prunable" || rawLine.startsWith("prunable ")) {
      prunable = true;
    }
  }

  if (wtPath === undefined || wtPath.length === 0) {
    return null;
  }
  return {
    path: wtPath,
    headSha,
    ...(branch === undefined ? {} : { branch }),
    detached,
    locked,
    prunable,
  };
}

export function parsePorcelainWorktrees(
  stdout: string,
): WorktreePorcelainEntry[] {
  const blocks = stdout
    .trim()
    .split(/\r?\n\r?\n/u)
    .filter((block) => block.trim().length > 0);
  const entries: WorktreePorcelainEntry[] = [];
  for (const block of blocks) {
    const entry = parseSinglePorcelainBlock(block);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function shouldReplacePrRecord(
  existing: RepoPrRecord | undefined,
  nextState: "OPEN" | "MERGED" | "CLOSED",
  nextUpdatedAtMs: number,
): boolean {
  if (existing === undefined) {
    return true;
  }
  if (nextState !== "OPEN" && existing.state === "OPEN") {
    return false;
  }
  if (nextState === "OPEN" && existing.state !== "OPEN") {
    return true;
  }
  return nextUpdatedAtMs === existing.updatedAtMs
    ? nextState === "MERGED" && existing.state !== "MERGED"
    : nextUpdatedAtMs > existing.updatedAtMs;
}

export function parseBatchPullRequests(
  stdout: string,
): Map<string, RepoPrRecord> {
  const map = new Map<string, RepoPrRecord>();
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return map;
  }
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(trimmed);
  } catch {
    return map;
  }
  const parsed = GhPrListSchema.safeParse(rawJson);
  if (!parsed.success) {
    return map;
  }
  for (const row of parsed.data) {
    const updatedAtMs = Date.parse(row.updatedAt);
    if (Number.isNaN(updatedAtMs)) {
      continue;
    }
    const existing = map.get(row.headRefName);
    if (shouldReplacePrRecord(existing, row.state, updatedAtMs)) {
      map.set(row.headRefName, {
        headRefName: row.headRefName,
        state: row.state,
        updatedAtMs,
        ...(row.headRefOid === undefined ? {} : { headRefOid: row.headRefOid }),
      });
    }
  }
  return map;
}

export async function mtimeMsIfExists(targetPath: string): Promise<number> {
  try {
    const info = await stat(targetPath);
    return info.mtimeMs;
  } catch {
    return 0;
  }
}

export async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function fileOrDirExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

const IN_PROGRESS_GIT_FILES = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "BISECT_LOG",
] as const;

export async function resolveWorktreeGitDir(
  wtPath: string,
  runner: CommandRunner,
): Promise<string | null> {
  const res = await runner(["git", "rev-parse", "--git-dir"], {
    cwd: wtPath,
    timeoutMs: 3000,
  });
  if (res.exitCode !== 0 || res.stdout.trim().length === 0) {
    return null;
  }
  const raw = res.stdout.trim();
  return path.isAbsolute(raw) ? raw : path.resolve(wtPath, raw);
}

export async function isMidGitOperation(gitDir: string): Promise<boolean> {
  for (const marker of IN_PROGRESS_GIT_FILES) {
    if (await fileOrDirExists(path.join(gitDir, marker))) {
      return true;
    }
  }
  return false;
}

export async function computeWorktreeLastActivityMs(options: {
  readonly wtPath: string;
  readonly gitDir: string;
  readonly runner: CommandRunner;
}): Promise<{
  readonly lastActivityMs: number;
  readonly commitEpochMs: number;
}> {
  const [wtMtime, dotGitMtime, headMtime, indexMtime, logRes] =
    await Promise.all([
      mtimeMsIfExists(options.wtPath),
      mtimeMsIfExists(path.join(options.wtPath, ".git")),
      mtimeMsIfExists(path.join(options.gitDir, "HEAD")),
      mtimeMsIfExists(path.join(options.gitDir, "index")),
      options.runner(["git", "log", "-1", "--format=%ct"], {
        cwd: options.wtPath,
        timeoutMs: 3000,
      }),
    ]);
  const rawEpoch = Number(logRes.stdout.trim());
  const commitEpochMs =
    logRes.exitCode === 0 && Number.isFinite(rawEpoch) && rawEpoch > 0
      ? rawEpoch * 1000
      : 0;
  return {
    lastActivityMs: Math.max(
      wtMtime,
      dotGitMtime,
      headMtime,
      indexMtime,
      commitEpochMs,
    ),
    commitEpochMs,
  };
}

export async function resolveDefaultBranch(
  repoPath: string,
  runner: CommandRunner,
): Promise<string | null> {
  const sym = await runner(
    ["git", "symbolic-ref", "refs/remotes/origin/HEAD", "--short"],
    { cwd: repoPath, timeoutMs: 3000 },
  );
  if (sym.exitCode === 0 && sym.stdout.trim().length > 0) {
    return sym.stdout.trim().replace(/^origin\//u, "");
  }
  const mainVerify = await runner(
    ["git", "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"],
    { cwd: repoPath, timeoutMs: 3000 },
  );
  return mainVerify.exitCode === 0 ? "main" : null;
}

async function countCommitsAhead(
  cwd: string,
  range: string,
  runner: CommandRunner,
): Promise<number | null> {
  const res = await runner(["git", "rev-list", "--count", range], {
    cwd,
    timeoutMs: 4000,
  });
  const trimmed = res.stdout.trim();
  return res.exitCode === 0 && /^\d+$/u.test(trimmed) ? Number(trimmed) : null;
}

async function hasUnpushedCommitsToExistingUpstream(
  wtPath: string,
  runner: CommandRunner,
): Promise<boolean> {
  const upstream = await runner(
    ["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { cwd: wtPath, timeoutMs: 3000 },
  );
  if (upstream.exitCode !== 0) {
    return false;
  }
  const ahead = await countCommitsAhead(wtPath, "@{u}..HEAD", runner);
  return ahead === null || ahead > 0;
}

async function hasNoUnappliedCherryCommits(
  wtPath: string,
  defaultBranch: string,
  runner: CommandRunner,
): Promise<boolean> {
  const cherry = await runner(
    ["git", "cherry", `origin/${defaultBranch}`, "HEAD"],
    { cwd: wtPath, timeoutMs: 4000 },
  );
  return (
    cherry.exitCode === 0 &&
    !cherry.stdout
      .split(/\r?\n/u)
      .some((line) => line.trimStart().startsWith("+"))
  );
}

export type EligibilityVerdict =
  | {
      readonly prune: true;
      readonly reason: string;
      readonly forceDeleteBranch: boolean;
    }
  | { readonly prune: false; readonly reason: string };

async function evaluateMergedPrEligibility(options: {
  readonly wt: WorktreePorcelainEntry;
  readonly defaultBranch: string;
  readonly pr: RepoPrRecord;
  readonly commitEpochMs: number;
  readonly runner: CommandRunner;
}): Promise<EligibilityVerdict> {
  const { wt, defaultBranch, pr, commitEpochMs, runner } = options;
  if (await hasUnpushedCommitsToExistingUpstream(wt.path, runner)) {
    return { prune: false, reason: "has local commits ahead of upstream" };
  }
  if (pr.headRefOid !== undefined && pr.headRefOid === wt.headSha) {
    return {
      prune: true,
      reason: `PR squash-merged at exact head ${wt.headSha.slice(0, 8)}`,
      forceDeleteBranch: true,
    };
  }
  const noPostMergeCommits =
    commitEpochMs > 0 && commitEpochMs <= pr.updatedAtMs;
  if (
    noPostMergeCommits &&
    (pr.headRefOid === undefined ||
      (await hasNoUnappliedCherryCommits(wt.path, defaultBranch, runner)))
  ) {
    return {
      prune: true,
      reason: "PR merged with no post-merge local commits",
      forceDeleteBranch: true,
    };
  }
  return { prune: false, reason: "local HEAD diverges from merged PR head" };
}

function evaluateClosedPrEligibility(
  wt: WorktreePorcelainEntry,
  pr: RepoPrRecord,
  commitEpochMs: number,
): EligibilityVerdict {
  const matchesHead =
    (pr.headRefOid !== undefined && pr.headRefOid === wt.headSha) ||
    (pr.headRefOid === undefined &&
      commitEpochMs > 0 &&
      commitEpochMs <= pr.updatedAtMs);
  return matchesHead
    ? {
        prune: true,
        reason: "closed PR (--include-closed-prs)",
        forceDeleteBranch: true,
      }
    : { prune: false, reason: "has unmerged commits" };
}

export async function evaluateBranchAndPrEligibility(options: {
  readonly wt: WorktreePorcelainEntry;
  readonly defaultBranch: string;
  readonly pr: RepoPrRecord | undefined;
  readonly commitEpochMs: number;
  readonly includeClosedPrs: boolean;
  readonly runner: CommandRunner;
}): Promise<EligibilityVerdict> {
  const { wt, defaultBranch, pr, commitEpochMs, runner } = options;
  if (pr?.state === "OPEN") {
    return { prune: false, reason: "open pull request" };
  }

  const aheadOfDefault = await countCommitsAhead(
    wt.path,
    `origin/${defaultBranch}..HEAD`,
    runner,
  );
  if (aheadOfDefault === 0) {
    const label = wt.detached
      ? `detached HEAD reachable from origin/${defaultBranch}`
      : `clean branch with 0 commits ahead of origin/${defaultBranch}`;
    return {
      prune: true,
      reason: label,
      forceDeleteBranch: pr?.state === "MERGED",
    };
  }

  if (pr?.state === "MERGED") {
    return evaluateMergedPrEligibility({
      wt,
      defaultBranch,
      pr,
      commitEpochMs,
      runner,
    });
  }

  return options.includeClosedPrs && pr?.state === "CLOSED"
    ? evaluateClosedPrEligibility(wt, pr, commitEpochMs)
    : { prune: false, reason: "has unmerged commits" };
}
