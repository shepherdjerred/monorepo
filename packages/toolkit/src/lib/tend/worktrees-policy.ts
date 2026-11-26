import { formatDurationCompact } from "./paths.ts";
import type { EligibilityVerdict } from "./worktrees-git.ts";

/** Lock reason Herdr writes on its pre-created pool slots. */
const HERDR_POOL_LOCK_REASON = "Herdr worktree pool";

const CLAUDE_AGENT_LOCK_PATTERN =
  /^claude agent \S+ \(pid (\d+)(?: start [^)]*)?\)$/u;

export type WorktreeLockState =
  | { readonly kind: "unlocked" }
  | { readonly kind: "herdr-pool" }
  | {
      readonly kind: "claude-agent";
      readonly pid: number;
      readonly alive: boolean;
    }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * Only a Claude-agent lock names a process whose death releases it. Every
 * other lock, including a bare one, was placed by something this policy does
 * not understand and is left alone.
 */
export function classifyWorktreeLock(options: {
  readonly locked: boolean;
  readonly lockReason?: string | undefined;
  readonly isPidAlive: (pid: number) => boolean;
}): WorktreeLockState {
  if (!options.locked) {
    return { kind: "unlocked" };
  }
  const reason = options.lockReason?.trim() ?? "";
  if (reason === HERDR_POOL_LOCK_REASON) {
    return { kind: "herdr-pool" };
  }
  const pidText = CLAUDE_AGENT_LOCK_PATTERN.exec(reason)?.[1];
  const pid = pidText === undefined ? Number.NaN : Number(pidText);
  return Number.isSafeInteger(pid) && pid > 0
    ? { kind: "claude-agent", pid, alive: options.isPidAlive(pid) }
    : { kind: "unknown", reason };
}

export type WorktreeLiveHold = {
  /** Which liveness source holds the worktree, e.g. `live Herdr terminal`. */
  readonly category: string;
  readonly detail: string;
};

export type WorktreePrState = "OPEN" | "MERGED" | "CLOSED" | "none" | "unknown";

/**
 * Facts that cost a `git status` to gather. They are only read once rows 1-5
 * of the policy have not already kept the worktree.
 */
export type WorktreeWorkFacts =
  | { readonly status: "timeout"; readonly timeoutMs: number }
  | { readonly status: "failed"; readonly detail: string }
  | {
      readonly status: "clean" | "dirty";
      readonly lastActivityMs: number;
      /** Commits on HEAD that are not on the default branch; `null` if unknown. */
      readonly aheadOfDefault: number | null;
      /** Whether the branch itself may be deleted once the worktree is gone. */
      readonly branchVerdict: EligibilityVerdict;
    };

export type WorktreeFacts = {
  readonly missing: boolean;
  readonly detached: boolean;
  readonly branch?: string | undefined;
  readonly defaultBranch: string;
  readonly lock: WorktreeLockState;
  /** Lives under Herdr's pool directory, whatever its lock says. */
  readonly poolSlot: boolean;
  readonly liveHold?: WorktreeLiveHold | undefined;
  readonly gitDirResolved: boolean;
  readonly midGitOperation: boolean;
  readonly prState: WorktreePrState;
  readonly nowMs: number;
  readonly minAgeMs: number;
  readonly work?: WorktreeWorkFacts | undefined;
};

export type WorktreePreserve =
  "dirty-snapshot" | "detached-head-ref" | "branch-kept";

export type WorktreeBranchDeletion = "none" | "delete" | "force-delete";

export type WorktreeDecision = {
  readonly action: "keep" | "remove" | "prune-metadata";
  /** Stable, human-readable grouping used for per-reason counts. */
  readonly category: string;
  readonly reason: string;
  readonly preserve: readonly WorktreePreserve[];
  readonly deleteBranch: WorktreeBranchDeletion;
  /** Release a dead Claude-agent lock before removing. */
  readonly unlock: boolean;
  readonly idleMs?: number | undefined;
};

function keep(category: string, reason: string = category): WorktreeDecision {
  return {
    action: "keep",
    category,
    reason,
    preserve: [],
    deleteBranch: "none",
    unlock: false,
  };
}

function decideLock(facts: WorktreeFacts): WorktreeDecision | null {
  const { lock } = facts;
  if (lock.kind === "herdr-pool" || facts.poolSlot) {
    return keep("Herdr worktree pool slot");
  }
  if (lock.kind === "claude-agent" && lock.alive) {
    return keep(
      "locked by a live Claude agent",
      `locked by a live Claude agent (pid ${String(lock.pid)})`,
    );
  }
  if (lock.kind === "unknown") {
    return keep(
      "locked for an unrecognized reason",
      lock.reason.length === 0
        ? "locked with no recorded reason"
        : `locked: ${lock.reason}`,
    );
  }
  return null;
}

/**
 * Rows 1-5 of the policy: everything that can be decided without running
 * `git status`. `null` means the worktree is not kept yet and the work facts
 * are needed.
 */
export function decideWorktreeEarly(
  facts: WorktreeFacts,
): WorktreeDecision | null {
  if (facts.missing) {
    return {
      action: "prune-metadata",
      category: "stale metadata",
      reason: "prunable stale worktree metadata (directory already missing)",
      preserve: [],
      deleteBranch: "none",
      unlock: false,
    };
  }
  const locked = decideLock(facts);
  if (locked !== null) {
    return locked;
  }
  if (facts.liveHold !== undefined) {
    return keep(
      facts.liveHold.category,
      `${facts.liveHold.category}: ${facts.liveHold.detail}`,
    );
  }
  if (!facts.gitDirResolved) {
    return keep("git directory unresolved", "could not resolve the git dir");
  }
  if (facts.midGitOperation) {
    return keep(
      "git operation in progress",
      "mid rebase, merge, cherry-pick, or bisect",
    );
  }
  return facts.prState === "OPEN" ? keep("open pull request") : null;
}

function describeAhead(aheadOfDefault: number | null): string {
  return aheadOfDefault === null
    ? "an unknown number of"
    : String(aheadOfDefault);
}

function decideRemoval(
  facts: WorktreeFacts,
  work: Extract<WorktreeWorkFacts, { status: "clean" | "dirty" }>,
  idleMs: number,
): WorktreeDecision {
  const preserve: WorktreePreserve[] = [];
  const notes: string[] = [work.branchVerdict.reason];
  if (work.status === "dirty") {
    // The snapshot commit's parent is HEAD, so it also keeps a detached HEAD.
    preserve.push("dirty-snapshot");
    notes.push("uncommitted work goes to a rescue ref");
  } else if (facts.detached && work.aheadOfDefault !== 0) {
    preserve.push("detached-head-ref");
    notes.push(
      `${describeAhead(work.aheadOfDefault)} commit(s) not on origin/${facts.defaultBranch} go to a rescue ref`,
    );
  }
  let deleteBranch: WorktreeBranchDeletion = "none";
  if (facts.branch !== undefined) {
    if (work.branchVerdict.prune) {
      deleteBranch = work.branchVerdict.forceDeleteBranch
        ? "force-delete"
        : "delete";
    } else {
      preserve.push("branch-kept");
      notes.push(`branch ${facts.branch} kept`);
    }
  }
  return {
    action: "remove",
    category: "idle",
    reason: `${notes.join("; ")} (idle ${formatDurationCompact(idleMs)})`,
    preserve,
    deleteBranch,
    unlock: facts.lock.kind === "claude-agent",
    idleMs,
  };
}

/**
 * The reaper policy, first match wins:
 *
 * 1. directory missing -> prune metadata
 * 2. pool slot, live Claude-agent lock, or unrecognized lock -> keep
 * 3. live session, process, lease, notice, or caller inside it -> keep
 * 4. mid git operation -> keep
 * 5. open pull request -> keep
 * 6. activity inside the idle window -> keep
 * 7. otherwise remove, preserving all work
 *
 * Anything that cannot be established (status, pull request state, activity)
 * keeps the worktree.
 */
export function decideWorktree(facts: WorktreeFacts): WorktreeDecision {
  const early = decideWorktreeEarly(facts);
  if (early !== null) {
    return early;
  }
  const { work } = facts;
  if (work === undefined) {
    throw new Error(
      "decideWorktree needs work facts once rows 1-5 do not keep the worktree",
    );
  }
  if (work.status === "timeout") {
    return keep(
      "git status timed out",
      `git status did not finish in ${formatDurationCompact(work.timeoutMs)}`,
    );
  }
  if (work.status === "failed") {
    return keep("git status failed", `git status failed: ${work.detail}`);
  }
  if (
    facts.prState === "unknown" &&
    facts.branch !== undefined &&
    work.aheadOfDefault !== 0
  ) {
    return keep(
      "pull request state unknown",
      `pull request state unknown and ${describeAhead(work.aheadOfDefault)} commit(s) ahead of origin/${facts.defaultBranch}`,
    );
  }
  if (work.lastActivityMs <= 0) {
    return keep("activity unknown", "no activity signal could be read");
  }
  const idleMs = Math.max(0, facts.nowMs - work.lastActivityMs);
  return idleMs < facts.minAgeMs
    ? keep(
        "recent activity",
        `last activity ${formatDurationCompact(idleMs)} ago (under ${formatDurationCompact(facts.minAgeMs)})`,
      )
    : decideRemoval(facts, work, idleMs);
}
