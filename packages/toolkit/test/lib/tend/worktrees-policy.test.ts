import { describe, expect, it } from "vitest";
import { parseProcessStartMs } from "#lib/tend/process-probe.ts";
import {
  classifyWorktreeLock,
  decideWorktree,
  decideWorktreeEarly,
  type WorktreeDecision,
  type WorktreeFacts,
  type WorktreeWorkFacts,
} from "#lib/tend/worktrees-policy.ts";

const DAY_MS = 86_400_000;
const NOW_MS = 100 * DAY_MS;

function idleWork(
  overrides: Partial<
    Extract<WorktreeWorkFacts, { status: "clean" | "dirty" }>
  > = {},
): WorktreeWorkFacts {
  return {
    status: "clean",
    lastActivityMs: NOW_MS - 9 * DAY_MS,
    aheadOfDefault: 2,
    branchVerdict: { prune: false, reason: "has unmerged commits" },
    hasSubmodules: false,
    ...overrides,
  };
}

function facts(overrides: Partial<WorktreeFacts> = {}): WorktreeFacts {
  return {
    missing: false,
    detached: false,
    branch: "feat/x",
    defaultBranch: "main",
    lock: { kind: "unlocked" },
    poolSlot: false,
    gitDirResolved: true,
    midGitOperation: false,
    prState: "none",
    nowMs: NOW_MS,
    minAgeMs: 3 * DAY_MS,
    work: idleWork(),
    ...overrides,
  };
}

const detached = { detached: true, branch: undefined } as const;

type PolicyCase = {
  readonly row: string;
  readonly facts: WorktreeFacts;
  readonly expected: Partial<WorktreeDecision>;
};

const KEEP_CASES: readonly PolicyCase[] = [
  {
    row: "2: Herdr pool lock",
    facts: facts({ lock: { kind: "herdr-pool" } }),
    expected: { action: "keep", category: "Herdr worktree pool slot" },
  },
  {
    row: "2: unlocked directory under the Herdr pool",
    facts: facts({ poolSlot: true }),
    expected: { action: "keep", category: "Herdr worktree pool slot" },
  },
  {
    row: "2: Claude agent lock with a live pid",
    facts: facts({ lock: { kind: "claude-agent", pid: 4242, alive: true } }),
    expected: {
      action: "keep",
      category: "locked by a live Claude agent",
      reason: "locked by a live Claude agent (pid 4242)",
    },
  },
  {
    row: "2: lock with an unrecognized reason",
    facts: facts({ lock: { kind: "unknown", reason: "manual hold" } }),
    expected: {
      action: "keep",
      category: "locked for an unrecognized reason",
      reason: "locked: manual hold",
    },
  },
  {
    row: "3: live session inside the worktree",
    facts: facts({
      liveHold: { category: "live Herdr terminal", detail: "/wt/packages/a" },
    }),
    expected: {
      action: "keep",
      category: "live Herdr terminal",
      reason: "live Herdr terminal: /wt/packages/a",
    },
  },
  {
    row: "4: mid rebase, merge, cherry-pick or bisect",
    facts: facts({ midGitOperation: true }),
    expected: { action: "keep", category: "git operation in progress" },
  },
  {
    row: "4: git dir cannot be resolved",
    facts: facts({ gitDirResolved: false }),
    expected: { action: "keep", category: "git directory unresolved" },
  },
  {
    row: "5: open pull request",
    facts: facts({ prState: "OPEN" }),
    expected: { action: "keep", category: "open pull request" },
  },
  {
    row: "6: activity two days ago",
    facts: facts({ work: idleWork({ lastActivityMs: NOW_MS - 2 * DAY_MS }) }),
    expected: {
      action: "keep",
      category: "recent activity",
      reason: "last activity 2d ago (under 3d)",
    },
  },
  {
    row: "fail closed: git status timed out",
    facts: facts({ work: { status: "timeout", timeoutMs: 60_000 } }),
    expected: {
      action: "keep",
      category: "git status timed out",
      reason: "git status did not finish in 1m",
    },
  },
  {
    row: "fail closed: git status failed",
    facts: facts({ work: { status: "failed", detail: "fatal: bad index" } }),
    expected: { action: "keep", category: "git status failed" },
  },
  {
    row: "fail closed: PR state unknown with commits ahead",
    facts: facts({ prState: "unknown" }),
    expected: { action: "keep", category: "pull request state unknown" },
  },
  {
    row: "fail closed: PR state unknown and ahead count unknown",
    facts: facts({
      prState: "unknown",
      work: idleWork({ aheadOfDefault: null }),
    }),
    expected: { action: "keep", category: "pull request state unknown" },
  },
  {
    row: "fail closed: no activity signal",
    facts: facts({ work: idleWork({ lastActivityMs: 0 }) }),
    expected: { action: "keep", category: "activity unknown" },
  },
  {
    row: "fail closed: idle, but it has submodules",
    facts: facts({ work: idleWork({ hasSubmodules: true }) }),
    expected: {
      action: "keep",
      category: "contains a submodule",
      reason:
        "contains a submodule, whose files cannot be saved before removal",
    },
  },
  {
    row: "fail closed: idle and dirty, with submodules",
    facts: facts({
      ...detached,
      work: idleWork({ status: "dirty", hasSubmodules: true }),
    }),
    expected: { action: "keep", category: "contains a submodule" },
  },
  {
    row: "1: directory missing but locked, so git keeps the metadata",
    facts: facts({
      missing: true,
      lock: { kind: "unknown", reason: "on the external drive" },
      work: undefined,
    }),
    expected: { action: "keep", category: "locked, directory missing" },
  },
  {
    row: "1: directory missing and locked by a dead Claude agent",
    facts: facts({
      missing: true,
      lock: { kind: "claude-agent", pid: 4343, alive: false },
      work: undefined,
    }),
    expected: { action: "keep", category: "locked, directory missing" },
  },
];

const REMOVE_CASES: readonly PolicyCase[] = [
  {
    row: "7: clean branch with unmerged commits keeps the branch",
    facts: facts(),
    expected: {
      action: "remove",
      preserve: ["branch-kept"],
      deleteBranch: "none",
      unlock: false,
      reason: "has unmerged commits; branch feat/x kept (idle 9d)",
    },
  },
  {
    row: "7: idle for exactly the window",
    facts: facts({ work: idleWork({ lastActivityMs: NOW_MS - 3 * DAY_MS }) }),
    expected: { action: "remove", idleMs: 3 * DAY_MS },
  },
  {
    row: "7: merged branch is force-deleted",
    facts: facts({
      prState: "MERGED",
      work: idleWork({
        branchVerdict: {
          prune: true,
          reason: "PR merged with no post-merge local commits",
          forceDeleteBranch: true,
        },
      }),
    }),
    expected: { action: "remove", preserve: [], deleteBranch: "force-delete" },
  },
  {
    row: "7: branch with nothing ahead is deleted safely",
    facts: facts({
      work: idleWork({
        aheadOfDefault: 0,
        branchVerdict: {
          prune: true,
          reason: "clean branch with 0 commits ahead of origin/main",
          forceDeleteBranch: false,
        },
      }),
    }),
    expected: { action: "remove", preserve: [], deleteBranch: "delete" },
  },
  {
    row: "7: dirty branch is snapshotted and its branch kept",
    facts: facts({ work: idleWork({ status: "dirty" }) }),
    expected: {
      action: "remove",
      preserve: ["dirty-snapshot", "branch-kept"],
      deleteBranch: "none",
    },
  },
  {
    row: "7: detached HEAD with unmerged commits gets a rescue ref",
    facts: facts(detached),
    expected: {
      action: "remove",
      preserve: ["detached-head-ref"],
      deleteBranch: "none",
    },
  },
  {
    row: "7: detached HEAD whose ahead count is unknown gets a rescue ref",
    facts: facts({ ...detached, work: idleWork({ aheadOfDefault: null }) }),
    expected: { action: "remove", preserve: ["detached-head-ref"] },
  },
  {
    row: "7: detached HEAD already on the default branch needs nothing",
    facts: facts({ ...detached, work: idleWork({ aheadOfDefault: 0 }) }),
    expected: { action: "remove", preserve: [], deleteBranch: "none" },
  },
  {
    row: "7: dirty detached HEAD is covered by the snapshot alone",
    facts: facts({ ...detached, work: idleWork({ status: "dirty" }) }),
    expected: { action: "remove", preserve: ["dirty-snapshot"] },
  },
  {
    row: "7: dead Claude agent lock is released",
    facts: facts({
      ...detached,
      lock: { kind: "claude-agent", pid: 4343, alive: false },
    }),
    expected: { action: "remove", unlock: true },
  },
  {
    row: "7: PR state unknown but nothing ahead",
    facts: facts({
      prState: "unknown",
      work: idleWork({
        aheadOfDefault: 0,
        branchVerdict: {
          prune: true,
          reason: "clean branch with 0 commits ahead of origin/main",
          forceDeleteBranch: false,
        },
      }),
    }),
    expected: { action: "remove", deleteBranch: "delete" },
  },
  {
    row: "7: PR state unknown does not hold a detached HEAD",
    facts: facts({ ...detached, prState: "unknown" }),
    expected: { action: "remove", preserve: ["detached-head-ref"] },
  },
];

describe("decideWorktree", () => {
  it("row 1: prunes metadata when an unlocked worktree's directory is missing, whatever else is true", () => {
    expect(
      decideWorktree(
        facts({
          missing: true,
          liveHold: { category: "live Herdr terminal", detail: "/wt" },
          prState: "OPEN",
          work: undefined,
        }),
      ),
    ).toMatchObject({ action: "prune-metadata", category: "stale metadata" });
  });

  it.each(KEEP_CASES)("row $row -> keep", ({ facts: input, expected }) => {
    const decision = decideWorktree(input);
    expect(decision).toMatchObject(expected);
    expect(decision.preserve).toEqual([]);
    expect(decision.deleteBranch).toBe("none");
    expect(decision.unlock).toBe(false);
  });

  it.each(REMOVE_CASES)("row $row", ({ facts: input, expected }) => {
    const decision = decideWorktree(input);
    expect(decision).toMatchObject(expected);
    expect(decision.category).toBe("idle");
  });

  it("applies the first matching row", () => {
    const everything = facts({
      lock: { kind: "herdr-pool" },
      liveHold: { category: "live Herdr terminal", detail: "/wt" },
      midGitOperation: true,
      prState: "OPEN",
    });
    expect(decideWorktree(everything).category).toBe(
      "Herdr worktree pool slot",
    );
    expect(
      decideWorktree({ ...everything, lock: { kind: "unlocked" } }).category,
    ).toBe("live Herdr terminal");
    expect(
      decideWorktree({
        ...everything,
        lock: { kind: "unlocked" },
        liveHold: undefined,
      }).category,
    ).toBe("git operation in progress");
  });

  it("decides rows 1-5 without work facts and refuses to guess past them", () => {
    expect(
      decideWorktreeEarly(facts({ prState: "OPEN", work: undefined }))?.action,
    ).toBe("keep");
    expect(decideWorktreeEarly(facts({ work: undefined }))).toBeNull();
    expect(() => decideWorktree(facts({ work: undefined }))).toThrow(
      "needs work facts",
    );
  });
});

function alive(pid: number): boolean {
  return pid === 4242;
}

const LOCK_START = "Thu Nov 20 10:11:12 2026";

function lockWithStart(start: string): string {
  return `claude agent agent-a1b2c3 (pid 4242 start ${start})`;
}

describe("classifyWorktreeLock", () => {
  it("recognizes the Herdr pool and Claude agent lock reasons", () => {
    expect(classifyWorktreeLock({ locked: false, isPidAlive: alive })).toEqual({
      kind: "unlocked",
    });
    expect(
      classifyWorktreeLock({
        locked: true,
        lockReason: "Herdr worktree pool",
        isPidAlive: alive,
      }),
    ).toEqual({ kind: "herdr-pool" });
    expect(
      classifyWorktreeLock({
        locked: true,
        lockReason:
          "claude agent agent-a1b2c3 (pid 4242 start Thu Nov 20 10:11:12 2026)",
        isPidAlive: alive,
      }),
    ).toEqual({ kind: "claude-agent", pid: 4242, alive: true });
    expect(
      classifyWorktreeLock({
        locked: true,
        lockReason: "claude agent agent-d4e5f6 (pid 4343)",
        isPidAlive: alive,
      }),
    ).toEqual({ kind: "claude-agent", pid: 4343, alive: false });
  });

  it.each([
    {
      name: "pid is not running",
      lockReason:
        "claude agent agent-d4e5f6 (pid 4343 start Thu Nov 19 04:29:24 2026)",
      currentStart: undefined,
      alive: false,
    },
    {
      name: "pid is running and started when the lock says",
      lockReason: lockWithStart(LOCK_START),
      // `ps` pads single-digit days; the same instant still matches.
      currentStart: "Thu Nov 20 10:11:12 2026    ",
      alive: true,
    },
    {
      name: "pid is running but started at another time (pid reused)",
      lockReason: lockWithStart(LOCK_START),
      currentStart: "Mon Nov 24 08:00:00 2026",
      alive: false,
    },
    {
      name: "pid is running and the lock has no start time",
      lockReason: "claude agent agent-a1b2c3 (pid 4242)",
      currentStart: "Mon Nov 24 08:00:00 2026",
      alive: true,
    },
    {
      name: "pid is running and the lock's start time does not parse",
      lockReason: lockWithStart("2026-11-20T10:11:12Z"),
      currentStart: "Mon Nov 24 08:00:00 2026",
      alive: true,
    },
    {
      name: "pid is running and the snapshot has no start time for it",
      lockReason: lockWithStart(LOCK_START),
      currentStart: undefined,
      alive: true,
    },
    {
      name: "pid is running and the snapshot start time does not parse",
      lockReason: lockWithStart(LOCK_START),
      currentStart: "20261124080000.000000-480",
      alive: true,
    },
  ])(
    "Claude agent lock: $name",
    ({ lockReason, currentStart, alive: expected }) => {
      const state = classifyWorktreeLock({
        locked: true,
        lockReason,
        isPidAlive: alive,
        processStartOf: () => currentStart,
      });
      expect(state).toMatchObject({ kind: "claude-agent", alive: expected });
    },
  );

  it("reads ps start times as UTC instants", () => {
    expect(parseProcessStartMs("Thu Nov 20 10:11:12 2026")).toBe(
      Date.UTC(2026, 10, 20, 10, 11, 12),
    );
    expect(parseProcessStartMs("Sun Nov  1 04:05:06 2026")).toBe(
      Date.UTC(2026, 10, 1, 4, 5, 6),
    );
    expect(parseProcessStartMs("Thu Foo 20 10:11:12 2026")).toBeNull();
    expect(parseProcessStartMs("unknown-4242")).toBeNull();
    expect(parseProcessStartMs("")).toBeNull();
  });

  it("treats every other lock as unknown", () => {
    for (const lockReason of [
      undefined,
      "",
      "manual hold",
      "claude agent agent-x",
      "claude agent agent-x (pid abc)",
      "Herdr worktree pool (old)",
    ]) {
      expect(
        classifyWorktreeLock({ locked: true, lockReason, isPidAlive: alive }),
      ).toEqual({ kind: "unknown", reason: lockReason ?? "" });
    }
  });
});
