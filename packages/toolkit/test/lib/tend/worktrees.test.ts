import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKTREE_MIN_AGE_MS } from "#lib/tend/paths.ts";
import type {
  CommandExecResult,
  LivenessSnapshot,
  OsProcessEntry,
  SurfaceSweepResult,
} from "#lib/tend/types.ts";
import { sweepWorktrees } from "#lib/tend/worktrees.ts";
import {
  directoryExists,
  parsePorcelainWorktrees,
  parsePullRequestList,
} from "#lib/tend/worktrees-git.ts";
import { ghAuthenticationFailure } from "#lib/tend/worktrees-inspect.ts";
import { parseStatusPorcelainZ } from "#lib/tend/worktrees-status.ts";
import {
  buildRepoFixture,
  createMockRunner,
  DAY_SECONDS,
  gitCalls,
  makeLiveness,
  NOW_MS,
  NOW_SECONDS,
  type MockRunnerOptions,
  type PullRequestRow,
  type RecordedCommand,
  type RepoFixture,
  type WorktreeSpec,
} from "./worktree-fixtures.ts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tend-worktrees-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const LIVE_AGENT_LOCK =
  "claude agent agent-a1b2c3 (pid 4242 start Thu Nov 20 10:11:12 2026)";
const DEAD_AGENT_LOCK =
  "claude agent agent-d4e5f6 (pid 4343 start Thu Nov 19 04:29:24 2026)";

type SweepHarness = {
  readonly repo: RepoFixture;
  readonly recorded: RecordedCommand[];
  readonly result: SurfaceSweepResult;
  readonly keepCategory: (name: string) => string | undefined;
};

async function runSweep(
  specs: readonly WorktreeSpec[],
  options: {
    readonly apply?: boolean;
    readonly protectedPaths?: (repo: RepoFixture) => string[];
    readonly hcAvailable?: boolean;
    readonly openPrs?: readonly PullRequestRow[] | null;
    readonly allPrs?: readonly PullRequestRow[] | null;
    readonly override?: MockRunnerOptions["override"];
    readonly prepare?: (repo: RepoFixture) => Promise<void>;
    /** What `hc ls --json` reports when asked again before a removal. */
    readonly hcTerminalCwds?: ((repo: RepoFixture) => string[]) | null;
    readonly processes?: LivenessSnapshot["processes"];
  } = {},
): Promise<SweepHarness> {
  const root = await makeTempDir();
  const repo = await buildRepoFixture(root, specs);
  await options.prepare?.(repo);
  const recorded: RecordedCommand[] = [];
  const result = await sweepWorktrees({
    liveness: makeLiveness({
      hcAvailable: options.hcAvailable ?? true,
      protectedPaths: new Set(options.protectedPaths?.(repo)),
      processes: options.processes ?? new Map(),
    }),
    runner: createMockRunner({
      repo,
      openPrs: options.openPrs,
      allPrs: options.allPrs,
      override: options.override,
      hcTerminalCwds:
        options.hcTerminalCwds === null ? null : options.hcTerminalCwds?.(repo),
      recorded,
    }),
    apply: options.apply ?? true,
    // The idle window is left to its default on purpose.
    gitDirs: [repo.gitRoot],
    homeDir: root,
    selfCwd: "/Users/jerred/elsewhere",
    nowMs: NOW_MS,
    isPidAlive: (pid) => pid === 4242,
  });
  return {
    repo,
    recorded,
    result,
    keepCategory: (name) =>
      result.decisions?.find(
        (decision) =>
          decision.target === repo.pathOf(name) && decision.action === "keep",
      )?.category,
  };
}

function isoDaysAgo(days: number, offsetSeconds = 0): string {
  return new Date(
    (NOW_SECONDS - days * DAY_SECONDS + offsetSeconds) * 1000,
  ).toISOString();
}

describe("worktree git parsing", () => {
  it("prefers OPEN PR over older MERGED PR when a branch name is reused", () => {
    const map = parsePullRequestList(
      JSON.stringify([
        {
          headRefName: "feat/reuse",
          state: "MERGED",
          updatedAt: "2026-10-01T00:00:00Z",
          headRefOid: "111",
        },
        {
          headRefName: "feat/reuse",
          state: "OPEN",
          updatedAt: "2026-11-10T00:00:00Z",
          headRefOid: "222",
        },
      ]),
    );
    expect(map?.get("feat/reuse")?.state).toBe("OPEN");
  });

  it("tells unparseable gh output apart from an empty list", () => {
    expect(parsePullRequestList("[]")?.size).toBe(0);
    expect(parsePullRequestList("")).toBeNull();
    expect(parsePullRequestList("HTTP 502")).toBeNull();
    expect(parsePullRequestList('{"message":"rate limited"}')).toBeNull();
  });

  it("keeps the lock reason from porcelain output", () => {
    const entries = parsePorcelainWorktrees(
      [
        "worktree /repo\nHEAD aaa\nbranch refs/heads/main",
        "worktree /pool/slot-1\nHEAD bbb\ndetached\nlocked Herdr worktree pool",
        `worktree /agent\nHEAD ccc\ndetached\nlocked ${LIVE_AGENT_LOCK}`,
        "worktree /bare\nHEAD ddd\ndetached\nlocked",
      ].join("\n\n"),
    );
    expect(entries.map((entry) => [entry.locked, entry.lockReason])).toEqual([
      [false, undefined],
      [true, "Herdr worktree pool"],
      [true, LIVE_AGENT_LOCK],
      [true, undefined],
    ]);
  });

  it("reads paths from NUL-separated status, skipping rename sources", () => {
    expect(
      parseStatusPorcelainZ(
        " M src/a b.ts\0?? scratch/\0R  new.ts\0old.ts\0D  gone.ts\0",
      ),
    ).toEqual(["src/a b.ts", "scratch/", "new.ts", "gone.ts"]);
    expect(parseStatusPorcelainZ("")).toEqual([]);
  });
});

describe("sweepWorktrees policy", () => {
  it("removes idle worktrees, deletes only merged branches, and keeps young, mid-rebase and held ones", async () => {
    const { repo, recorded, result, keepCategory } = await runSweep(
      [
        { name: "squash", branch: "feat/squash", ageDays: 9, ahead: 3 },
        { name: "diverged", branch: "feat/diverged", ageDays: 9, ahead: 4 },
        { name: "young", branch: "feat/young", ageDays: 2, ahead: 1 },
        {
          name: "rebase",
          branch: "feat/rebase",
          ageDays: 9,
          marker: "rebase-merge",
        },
        { name: "held", branch: "feat/held", ageDays: 9, ahead: 1 },
      ],
      {
        protectedPaths: (fixture) => [fixture.pathOf("held")],
        allPrs: [
          {
            headRefName: "feat/squash",
            state: "MERGED",
            updatedAt: isoDaysAgo(9),
            headRefOid: "head-squash",
          },
          {
            headRefName: "feat/diverged",
            state: "MERGED",
            updatedAt: isoDaysAgo(9, -3600),
            headRefOid: "oldsha00",
          },
        ],
      },
    );

    expect(result.candidates.map((c) => c.target)).toEqual([
      repo.pathOf("squash"),
      repo.pathOf("diverged"),
    ]);
    expect(result.actions.map((action) => action.status)).toEqual([
      "removed",
      "removed",
    ]);
    const calls = gitCalls(recorded);
    expect(calls).toContainEqual(["worktree", "remove", repo.pathOf("squash")]);
    // A merged branch goes only if it is still the commit that was judged.
    expect(calls).toContainEqual([
      "update-ref",
      "-d",
      "refs/heads/feat/squash",
      "head-squash",
    ]);
    expect(calls).toContainEqual([
      "config",
      "--remove-section",
      "branch.feat/squash",
    ]);
    expect(calls).toContainEqual([
      "worktree",
      "remove",
      repo.pathOf("diverged"),
    ]);
    expect(calls.filter((call) => call[0] === "branch")).toEqual([]);
    expect(calls.filter((call) => call[1] === "-d")).toHaveLength(1);
    expect(result.actions[1]?.detail).toBe("branch feat/diverged kept");
    expect(calls).toContainEqual(["worktree", "prune"]);

    expect(keepCategory("young")).toBe("recent activity");
    expect(keepCategory("rebase")).toBe("git operation in progress");
    expect(keepCategory("held")).toBe("protected path");
    expect(result.decisions).toHaveLength(5);
  });

  it("uses the three-day idle window by default", async () => {
    expect(DEFAULT_WORKTREE_MIN_AGE_MS).toBe(3 * DAY_SECONDS * 1000);
    const { result, keepCategory, repo } = await runSweep(
      [
        { name: "idle-2d", ageDays: 2.9 },
        { name: "idle-3d", ageDays: 3.1 },
      ],
      { apply: false },
    );
    expect(keepCategory("idle-2d")).toBe("recent activity");
    expect(result.candidates.map((c) => c.target)).toEqual([
      repo.pathOf("idle-3d"),
    ]);
    expect(result.actions[0]?.status).toBe("planned");
  });

  it("does not treat a freshly rewritten index as activity", async () => {
    const { result, repo, recorded } = await runSweep(
      [{ name: "viewed", ageDays: 9, indexAgeDays: 0 }],
      { apply: false },
    );
    expect(result.candidates.map((c) => c.target)).toEqual([
      repo.pathOf("viewed"),
    ]);
    const statusCall = recorded.find((command) =>
      command.argv.includes("status"),
    );
    expect(statusCall?.argv).toEqual([
      "git",
      "--no-optional-locks",
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain",
      "--untracked-files=all",
      "-z",
    ]);
  });

  it("counts a recently edited uncommitted file as activity", async () => {
    const { keepCategory, result } = await runSweep(
      [
        { name: "editing", ageDays: 9, status: " M notes.md\0" },
        // Recent work inside an old untracked directory: only the file's
        // own mtime shows it, which is why status lists untracked files.
        { name: "scratch", ageDays: 9, status: "?? scratch/deep/draft.txt\0" },
        // A deleted file whose directory went with it: the nearest directory
        // that still exists records the deletion.
        { name: "pruned", ageDays: 9, status: " D src/obsolete/a.ts\0" },
        { name: "untouched", ageDays: 9, status: " M old.md\0" },
      ],
      {
        apply: false,
        prepare: async (repo) => {
          const old = new Date((NOW_SECONDS - 9 * DAY_SECONDS) * 1000);
          const recent = new Date((NOW_SECONDS - 3600) * 1000);
          const place = async (name: string, file: string, at: Date) => {
            const root = repo.pathOf(name);
            await Bun.write(path.join(root, file), "x");
            await utimes(path.join(root, file), at, at);
            // Creating the file touched every directory above it.
            for (
              let dir = path.dirname(path.join(root, file));
              dir.length >= root.length;
              dir = path.dirname(dir)
            ) {
              await utimes(dir, old, old);
            }
          };
          await place("editing", "notes.md", recent);
          await place("scratch", "scratch/deep/draft.txt", recent);
          await place("untouched", "old.md", old);
          await place("pruned", "src/kept.ts", old);
          await utimes(path.join(repo.pathOf("pruned"), "src"), recent, recent);
        },
      },
    );
    expect(keepCategory("editing")).toBe("recent activity");
    expect(keepCategory("scratch")).toBe("recent activity");
    expect(keepCategory("pruned")).toBe("recent activity");
    expect(result.candidates.map((c) => path.basename(c.target))).toEqual([
      "untouched",
    ]);
  });

  it("holds the whole surface when hc is unavailable", async () => {
    const { result, recorded } = await runSweep(
      [{ name: "idle", ageDays: 9 }],
      { hcAvailable: false },
    );
    expect(result.heldReason).toContain("hc ls --json unavailable");
    expect(result.candidates).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("keeps a worktree whose status times out or fails, and says why", async () => {
    const { result, keepCategory } = await runSweep([
      {
        name: "slow",
        ageDays: 9,
        statusResult: { exitCode: 143, stdout: "", stderr: "", timedOut: true },
      },
      {
        name: "broken",
        ageDays: 9,
        statusResult: { exitCode: 128, stdout: "", stderr: "fatal: bad index" },
      },
    ]);
    expect(result.candidates).toEqual([]);
    expect(keepCategory("slow")).toBe("git status timed out");
    expect(keepCategory("broken")).toBe("git status failed");
    expect(
      result.decisions?.map((decision) => decision.reason).join("\n"),
    ).toContain("fatal: bad index");
  });
});

describe("sweepWorktrees locks", () => {
  it("keeps pool slots, live-agent locks and unrecognized locks, and unlocks only a dead agent's", async () => {
    const { repo, recorded, result, keepCategory } = await runSweep([
      { name: "pool-lock", ageDays: 30, lock: "Herdr worktree pool" },
      {
        name: "pool-path",
        relativeDir: ".herdr/worktrees/.pool/abc123/slot-1",
        ageDays: 30,
      },
      { name: "live-agent", ageDays: 30, lock: LIVE_AGENT_LOCK },
      { name: "dead-agent", ageDays: 30, lock: DEAD_AGENT_LOCK },
      { name: "bare-lock", ageDays: 30, lock: true },
      { name: "odd-lock", ageDays: 30, lock: "claude agent in limbo" },
    ]);

    expect(keepCategory("pool-lock")).toBe("Herdr worktree pool slot");
    expect(keepCategory("pool-path")).toBe("Herdr worktree pool slot");
    expect(keepCategory("live-agent")).toBe("locked by a live Claude agent");
    expect(keepCategory("bare-lock")).toBe("locked for an unrecognized reason");
    expect(keepCategory("odd-lock")).toBe("locked for an unrecognized reason");
    expect(result.candidates.map((c) => c.target)).toEqual([
      repo.pathOf("dead-agent"),
    ]);
    const calls = gitCalls(recorded);
    expect(calls.filter((call) => call[1] === "unlock")).toEqual([
      ["worktree", "unlock", repo.pathOf("dead-agent")],
    ]);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([
      ["worktree", "remove", repo.pathOf("dead-agent")],
    ]);
  });
});

function claudeProcess(processStart: string): OsProcessEntry {
  return {
    pid: 4242,
    ppid: 1,
    processStart,
    elapsedSeconds: 60,
    command: "claude",
    args: "claude",
  };
}

/** `ps -o lstart=` answering with one start time, whatever the pid. */
function processStartNow(start: string): MockRunnerOptions["override"] {
  return (command) =>
    command.argv[0] === "ps"
      ? { exitCode: 0, stdout: `${start}\n`, stderr: "" }
      : undefined;
}

describe("sweepWorktrees lock and liveness rechecks", () => {
  it("releases a Claude agent lock whose pid now belongs to another process", async () => {
    const specs: WorktreeSpec[] = [
      { name: "agent", ageDays: 30, lock: LIVE_AGENT_LOCK },
    ];
    const same = await runSweep(specs, {
      processes: new Map([[4242, claudeProcess("Thu Nov 20 10:11:12 2026")]]),
    });
    expect(same.keepCategory("agent")).toBe("locked by a live Claude agent");
    expect(same.result.candidates).toEqual([]);

    // The pid is seen with another start time in the snapshot, and still
    // has it when asked again now.
    const reused = await runSweep(specs, {
      processes: new Map([[4242, claudeProcess("Mon Nov 24 08:00:00 2026")]]),
      override: processStartNow("Mon Nov 24 08:00:00 2026"),
    });
    expect(reused.result.actions.map((action) => action.status)).toEqual([
      "removed",
    ]);
    expect(gitCalls(reused.recorded)).toContainEqual([
      "worktree",
      "unlock",
      reused.repo.pathOf("agent"),
    ]);
  });

  it("does not call a lock dead on a start time older than the lock", async () => {
    // The snapshot saw an earlier process on this pid. The agent that holds
    // the lock started afterwards and reused the number.
    const { keepCategory, result, recorded } = await runSweep(
      [{ name: "agent", ageDays: 30, lock: LIVE_AGENT_LOCK }],
      {
        processes: new Map([[4242, claudeProcess("Mon Nov 16 08:00:00 2026")]]),
        override: processStartNow("Thu Nov 20 10:11:12 2026"),
      },
    );
    expect(keepCategory("agent")).toBe("locked by a live Claude agent");
    expect(result.candidates).toEqual([]);
    expect(recorded.filter((command) => command.argv[0] === "ps")).toEqual([
      expect.objectContaining({ argv: ["ps", "-o", "lstart=", "-p", "4242"] }),
    ]);
  });

  it("asks Herdr again before each removal and skips a worktree a terminal has entered", async () => {
    const specs: WorktreeSpec[] = [
      { name: "entered", ageDays: 9, status: "?? scratch.txt\0" },
      { name: "quiet", ageDays: 9 },
    ];
    const { repo, recorded, result, keepCategory } = await runSweep(specs, {
      hcTerminalCwds: (fixture) => [
        "/Users/jerred/elsewhere",
        path.join(fixture.pathOf("entered"), "packages", "app"),
      ],
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.actions.map((action) => action.status)).toEqual([
      "skipped",
      "removed",
    ]);
    expect(result.actions[0]?.detail).toContain(
      "live Herdr terminal appeared during the sweep: ",
    );
    expect(result.actions[0]?.detail).toContain("entered/packages/app");
    expect(keepCategory("entered")).toBe("live Herdr terminal");
    expect(recorded.filter((command) => command.argv[0] === "hc")).toEqual([
      expect.objectContaining({ argv: ["hc", "ls", "--json"] }),
      expect.objectContaining({ argv: ["hc", "ls", "--json"] }),
    ]);
    // Nothing was saved, unlocked or removed for the worktree in use.
    expect(gitCalls(recorded, repo.pathOf("entered"))).not.toContainEqual(
      expect.arrayContaining(["add"]),
    );
    expect(gitCalls(recorded).filter((call) => call[1] === "remove")).toEqual([
      ["worktree", "remove", repo.pathOf("quiet")],
    ]);

    const dryRun = await runSweep(specs, { apply: false });
    expect(
      dryRun.recorded.filter((command) => command.argv[0] === "hc"),
    ).toEqual([]);
  });

  it("skips every removal when Herdr cannot be asked again", async () => {
    const { recorded, result, keepCategory } = await runSweep(
      [
        { name: "first", ageDays: 9, status: "?? scratch.txt\0" },
        { name: "second", ageDays: 9, ahead: 2 },
      ],
      { hcTerminalCwds: null },
    );
    expect(result.actions.map((action) => action.status)).toEqual([
      "skipped",
      "skipped",
    ]);
    expect(result.actions[0]?.detail).toBe(
      "hc ls --json failed before removal; live Herdr sessions cannot be seen",
    );
    expect(keepCategory("first")).toBe("Herdr sessions unknown");
    expect(keepCategory("second")).toBe("Herdr sessions unknown");
    const calls = gitCalls(recorded);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([]);
    expect(calls.filter((call) => call[0] === "update-ref")).toEqual([]);
    expect(calls.filter((call) => call[0] === "add")).toEqual([]);
  });
});

describe("sweepWorktrees preserves work", () => {
  it("snapshots a dirty worktree through a temporary index, then force-removes it", async () => {
    const { repo, recorded, result } = await runSweep([
      {
        name: "dirty",
        branch: "feat/dirty",
        ageDays: 9,
        ahead: 2,
        status: " M src/app.ts\0?? scratch.txt\0",
      },
    ]);
    const wtPath = repo.pathOf("dirty");
    const calls = gitCalls(recorded, wtPath).map((call) => call[0]);
    expect(calls.slice(calls.indexOf("rev-list") + 1)).toEqual([
      // Still the commit that was inspected?
      "rev-parse",
      // Staged state first, then the working tree on top of it.
      "write-tree",
      "add",
      "ls-files",
      "write-tree",
      "commit-tree",
      "commit-tree",
      "update-ref",
      "fsmonitor--daemon",
      // Read again immediately before the forced removal.
      "rev-parse",
      "write-tree",
      "add",
      "ls-files",
      "write-tree",
    ]);
    const commits = gitCalls(recorded, wtPath).filter(
      (call) => call[0] === "commit-tree",
    );
    expect(commits.map((call) => call.slice(1, 4))).toEqual([
      ["tree0001", "-p", "head-dirty"],
      ["tree0001", "-p", "commit0001"],
    ]);

    const snapshotCommands = recorded.filter(
      (command) => command.env["GIT_INDEX_FILE"] !== undefined,
    );
    expect(snapshotCommands).toHaveLength(8);
    const indexFiles = new Set(
      snapshotCommands.map((command) => command.env["GIT_INDEX_FILE"]),
    );
    expect(indexFiles.size).toBe(2);
    for (const temporaryIndex of indexFiles) {
      expect(temporaryIndex).not.toBe(
        path.join(repo.worktrees.get(wtPath)?.gitDir ?? "", "index"),
      );
      expect(await Bun.file(temporaryIndex ?? "").exists()).toBe(false);
    }
    // An inherited git context cannot redirect any of it.
    for (const command of recorded.filter((c) => c.argv[0] === "git")) {
      expect(command.env).toMatchObject({
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
      });
      expect(Object.keys(command.env)).toContain("GIT_DIR");
    }

    const rescueRef = "refs/tend/rescue/dirty-20251009T085320Z";
    expect(gitCalls(recorded, wtPath)).toContainEqual([
      "update-ref",
      "-m",
      "toolkit tend rescue",
      rescueRef,
      "commit0001",
      "",
    ]);
    expect(gitCalls(recorded)).toContainEqual([
      "worktree",
      "remove",
      "--force",
      wtPath,
    ]);
    expect(result.actions).toEqual([
      expect.objectContaining({
        status: "removed",
        detail: `work saved to ${rescueRef}; branch feat/dirty kept`,
      }),
    ]);
    expect(gitCalls(recorded).filter((call) => call[0] === "branch")).toEqual(
      [],
    );
  });

  it("keeps the worktree when the snapshot fails", async () => {
    const { repo, recorded, result, keepCategory } = await runSweep(
      [{ name: "dirty", ageDays: 9, status: "?? scratch.txt\0" }],
      {
        override: (command) =>
          command.argv.includes("write-tree")
            ? { exitCode: 128, stdout: "", stderr: "fatal: unable to write" }
            : undefined,
      },
    );
    expect(result.actions).toEqual([
      expect.objectContaining({
        status: "failed",
        detail:
          "worktree kept: could not save its work (git write-tree (staged): fatal: unable to write)",
      }),
    ]);
    expect(keepCategory("dirty")).toBe("removal failed");
    const calls = gitCalls(recorded);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([]);
    expect(calls.filter((call) => call[0] === "update-ref")).toEqual([]);
    expect(
      await Bun.file(path.join(repo.pathOf("dirty"), ".git")).exists(),
    ).toBe(true);
  });

  it("writes a rescue ref for a detached HEAD with commits that are not on the default branch", async () => {
    const { repo, recorded, result } = await runSweep([
      { name: "detached-ahead", ageDays: 9, ahead: 2, head: "feedface" },
      { name: "detached-merged", ageDays: 9, ahead: 0 },
    ]);
    const updateRefs = gitCalls(recorded).filter(
      (call) => call[0] === "update-ref",
    );
    expect(updateRefs).toEqual([
      [
        "update-ref",
        "-m",
        "toolkit tend rescue",
        "refs/tend/rescue/detached-ahead-20251009T085320Z",
        "feedface",
        "",
      ],
    ]);
    expect(result.actions.map((action) => action.status)).toEqual([
      "removed",
      "removed",
    ]);
    expect(result.actions[0]?.detail).toBe(
      "work saved to refs/tend/rescue/detached-ahead-20251009T085320Z",
    );
    expect(gitCalls(recorded)).toContainEqual([
      "worktree",
      "remove",
      repo.pathOf("detached-merged"),
    ]);
  });

  it("keeps a detached worktree when its rescue ref cannot be written", async () => {
    const { recorded, result } = await runSweep(
      [{ name: "detached-ahead", ageDays: 9, ahead: 2 }],
      {
        override: (command) =>
          command.argv.includes("update-ref")
            ? { exitCode: 1, stdout: "", stderr: "fatal: ref exists" }
            : undefined,
      },
    );
    expect(result.actions[0]?.status).toBe("failed");
    expect(gitCalls(recorded).filter((call) => call[1] === "remove")).toEqual(
      [],
    );
  });

  it("removes an idle worktree but keeps its unmerged branch", async () => {
    const { repo, recorded, result } = await runSweep([
      { name: "unmerged", branch: "feat/unmerged", ageDays: 9, ahead: 5 },
      { name: "merged", branch: "feat/merged", ageDays: 9, ahead: 0 },
    ]);
    const calls = gitCalls(recorded);
    expect(calls).toContainEqual([
      "worktree",
      "remove",
      repo.pathOf("unmerged"),
    ]);
    expect(calls.filter((call) => call[0] === "branch")).toEqual([
      ["branch", "-d", "feat/merged"],
    ]);
    expect(calls.filter((call) => call[0] === "update-ref")).toEqual([]);
    expect(result.candidates[0]?.metadata).toMatchObject({
      preserve: "branch-kept",
      deleteBranch: "none",
    });
  });
});

describe("sweepWorktrees pull requests", () => {
  const stale: WorktreeSpec = {
    name: "old-pr",
    branch: "feat/old-pr",
    ageDays: 40,
    ahead: 3,
  };

  it("keeps a branch whose open PR only the open-state query returns", async () => {
    const { recorded, result, keepCategory } = await runSweep([stale], {
      openPrs: [
        {
          headRefName: "feat/old-pr",
          state: "OPEN",
          updatedAt: isoDaysAgo(40),
        },
      ],
      allPrs: [],
    });
    const ghStates = recorded
      .filter((command) => command.argv[0] === "gh")
      .map((command) => command.argv[command.argv.indexOf("--state") + 1]);
    expect(ghStates).toEqual(["open", "all"]);
    expect(keepCategory("old-pr")).toBe("open pull request");
    expect(result.candidates).toEqual([]);
  });

  it("keeps branches with commits ahead when open PRs cannot be listed", async () => {
    const { repo, result, keepCategory } = await runSweep(
      [
        stale,
        { name: "no-commits", branch: "feat/empty", ageDays: 40, ahead: 0 },
        { name: "detached", ageDays: 40, ahead: 0 },
      ],
      { openPrs: null, allPrs: null },
    );
    expect(keepCategory("old-pr")).toBe("pull request state unknown");
    expect(result.candidates.map((c) => c.target)).toEqual([
      repo.pathOf("no-commits"),
      repo.pathOf("detached"),
    ]);
    expect(result.warnings.join("\n")).toContain(
      "Open pull requests could not be listed",
    );
  });

  it.each([
    [
      "a refused token",
      1,
      "HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth refresh -h github.com\n",
      "HTTP 401: Bad credentials (https://api.github.com/graphql)",
    ],
    [
      "no login at all",
      4,
      "To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n",
      "To get started with GitHub CLI, please run:  gh auth login",
    ],
  ])(
    "names authentication as the failure when gh has %s",
    async (_case, exitCode, stderr, firstLine) => {
      const { repo, result, keepCategory } = await runSweep([stale], {
        override: (command) =>
          command.argv[0] === "gh"
            ? { exitCode, stdout: "", stderr }
            : undefined,
      });
      // Still fails closed, and says which layer to fix, once.
      expect(keepCategory("old-pr")).toBe("pull request state unknown");
      expect(result.warnings).toEqual([
        `gh is not authenticated: ${firstLine}; pull requests could not be listed in ${repo.repoPath}, so every branch worktree with commits ahead of the default branch is kept`,
      ]);
    },
  );

  it("does not call another gh failure an authentication failure", () => {
    expect(
      ghAuthenticationFailure({
        exitCode: 1,
        stderr:
          "error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com",
      }),
    ).toBeNull();
    expect(
      ghAuthenticationFailure({
        exitCode: 1,
        stderr: "The token in /Users/x/.config/gh/hosts.yml is invalid.",
      }),
    ).toBe("The token in /Users/x/.config/gh/hosts.yml is invalid.");
    expect(ghAuthenticationFailure({ exitCode: 4, stderr: "" })).toBe(
      "gh exited 4",
    );
  });

  it("treats unparseable gh output as unknown rather than as no pull requests", async () => {
    const { keepCategory } = await runSweep([stale], {
      override: (command) =>
        command.argv[0] === "gh"
          ? { exitCode: 0, stdout: "", stderr: "" }
          : undefined,
    });
    expect(keepCategory("old-pr")).toBe("pull request state unknown");
  });
});

function ok(stdout: string): CommandExecResult {
  return { exitCode: 0, stdout, stderr: "" };
}

describe("sweepWorktrees re-verifies before removing", () => {
  it("leaves a worktree whose HEAD moved after it was inspected", async () => {
    const { recorded, result, keepCategory } = await runSweep(
      [
        { name: "detached", ageDays: 9, ahead: 2, head: "aaaa1111" },
        { name: "branch", branch: "feat/b", ageDays: 9, head: "bbbb2222" },
      ],
      {
        override: (command) =>
          command.argv.includes("rev-parse") && command.argv.includes("HEAD")
            ? ok("cccc3333\n")
            : undefined,
      },
    );
    expect(
      result.actions.map((action) => [action.status, action.detail]),
    ).toEqual([
      [
        "skipped",
        "changed during the sweep: HEAD moved from aaaa1111 to cccc3333",
      ],
      [
        "skipped",
        "changed during the sweep: HEAD moved from bbbb2222 to cccc3333",
      ],
    ]);
    expect(keepCategory("detached")).toBe("changed during the sweep");
    const calls = gitCalls(recorded);
    // No rescue ref at the stale commit, and nothing removed or deleted.
    expect(calls.filter((call) => call[0] === "update-ref")).toEqual([]);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([]);
    expect(calls.filter((call) => call[0] === "branch")).toEqual([]);
  });

  it("keeps a merged branch that a worktree has checked out, or that cannot be checked", async () => {
    const merged: WorktreeSpec = {
      name: "squash",
      branch: "feat/squash",
      ageDays: 9,
      ahead: 3,
    };
    const allPrs: PullRequestRow[] = [
      {
        headRefName: "feat/squash",
        state: "MERGED",
        updatedAt: isoDaysAgo(9),
        headRefOid: "head-squash",
      },
    ];
    const elsewhere = await runSweep([merged], {
      allPrs,
      override: (command) =>
        command.argv.includes("for-each-ref")
          ? ok("/somewhere/else\n")
          : undefined,
    });
    expect(elsewhere.result.actions[0]).toMatchObject({
      status: "removed",
      detail: "branch feat/squash kept (checked out in /somewhere/else)",
    });
    expect(gitCalls(elsewhere.recorded)).toContainEqual([
      "for-each-ref",
      "--format=%(worktreepath)",
      "refs/heads/feat/squash",
    ]);

    const unknown = await runSweep([merged], {
      allPrs,
      override: (command) =>
        command.argv.includes("for-each-ref")
          ? { exitCode: 129, stdout: "", stderr: "unknown field name" }
          : undefined,
    });
    expect(unknown.result.actions[0]?.detail).toBe(
      "branch feat/squash kept (could not tell whether it is checked out)",
    );
    for (const sweep of [elsewhere, unknown]) {
      expect(
        gitCalls(sweep.recorded).filter((call) => call[0] === "update-ref"),
      ).toEqual([]);
    }
  });

  it("leaves a worktree that was locked, or re-locked, after it was inspected", async () => {
    const { recorded, result } = await runSweep(
      [
        { name: "newly-locked", ageDays: 9 },
        { name: "relocked", ageDays: 30, lock: DEAD_AGENT_LOCK },
      ],
      {
        prepare: async (repo) => {
          const gitDir = (name: string) =>
            repo.worktrees.get(repo.pathOf(name))?.gitDir ?? "";
          await Bun.write(path.join(gitDir("newly-locked"), "locked"), "mine");
          await Bun.write(
            path.join(gitDir("relocked"), "locked"),
            `${LIVE_AGENT_LOCK}\n`,
          );
        },
      },
    );
    expect(
      result.actions.map((action) => [action.status, action.detail]),
    ).toEqual([
      ["skipped", "changed during the sweep: its lock changed"],
      ["skipped", "changed during the sweep: its lock changed"],
    ]);
    const calls = gitCalls(recorded);
    expect(calls.filter((call) => call[1] === "unlock")).toEqual([]);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([]);
  });

  it("does not force-remove a worktree whose files changed after they were saved", async () => {
    let treesWritten = 0;
    const { repo, recorded, result, keepCategory } = await runSweep(
      [{ name: "dirty", ageDays: 9, status: " M src/app.ts\0" }],
      {
        override: (command) => {
          const writesTree = command.argv.includes("write-tree");
          treesWritten += writesTree ? 1 : 0;
          // Staged and working trees at the snapshot, then again before the
          // removal, by which time an editor has saved the file once more.
          const tree = treesWritten === 4 ? "tree-after-edit" : "tree0001";
          return writesTree ? ok(`${tree}\n`) : undefined;
        },
      },
    );
    const rescueRef = "refs/tend/rescue/dirty-20251009T085320Z";
    expect(result.actions).toEqual([
      expect.objectContaining({
        status: "skipped",
        detail: `changed during the sweep: files changed after they were saved; work saved to ${rescueRef}`,
      }),
    ]);
    expect(keepCategory("dirty")).toBe("changed during the sweep");
    expect(treesWritten).toBe(4);
    const calls = gitCalls(recorded);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([]);
    expect(
      await Bun.file(path.join(repo.pathOf("dirty"), ".git")).exists(),
    ).toBe(true);
  });

  it("keeps a worktree that has submodules instead of trying to remove it", async () => {
    const { recorded, result, keepCategory } = await runSweep([
      { name: "with-submodule", ageDays: 9, submodules: true },
      {
        name: "dirty-submodule",
        ageDays: 9,
        submodules: true,
        status: " M deps/lib\0",
      },
      { name: "young-submodule", ageDays: 1, submodules: true },
    ]);
    expect(result.candidates).toEqual([]);
    expect(keepCategory("with-submodule")).toBe("contains a submodule");
    expect(keepCategory("dirty-submodule")).toBe("contains a submodule");
    expect(keepCategory("young-submodule")).toBe("recent activity");
    expect(gitCalls(recorded).filter((call) => call[1] === "remove")).toEqual(
      [],
    );
  });

  it("refuses a snapshot that would hold a gitlink in place of files", async () => {
    const { recorded, result } = await runSweep(
      [{ name: "dirty", ageDays: 9, status: "?? vendor/inner/\0" }],
      {
        override: (command) =>
          command.argv.includes("ls-files")
            ? ok(
                [
                  "100644 1111 0\tREADME.md",
                  "160000 2222 0\tvendor/inner",
                  "",
                ].join("\0"),
              )
            : undefined,
      },
    );
    expect(result.actions).toEqual([
      expect.objectContaining({
        status: "failed",
        detail:
          "worktree kept: could not save its work (contains a submodule or nested git repository at vendor/inner, whose files a snapshot cannot save)",
      }),
    ]);
    const calls = gitCalls(recorded);
    expect(calls.filter((call) => call[0] === "commit-tree")).toEqual([]);
    expect(calls.filter((call) => call[1] === "remove")).toEqual([]);
  });
});

describe("sweepWorktrees metadata and repositories it cannot judge", () => {
  const gone: WorktreeSpec = { name: "gone", ageDays: 30, absent: true };

  it("reports stale metadata as removed only once the list no longer has it", async () => {
    let lists = 0;
    const pruned = await runSweep([gone, { name: "idle", ageDays: 1 }], {
      override: (command) => {
        const isList =
          command.argv[1] === "worktree" && command.argv[2] === "list";
        lists += isList ? 1 : 0;
        // After `git worktree prune` the entry is gone from the list.
        return isList && lists > 1
          ? ok("worktree /repo\nHEAD aaaa\n")
          : undefined;
      },
    });
    expect(lists).toBe(2);
    expect(pruned.result.actions).toEqual([
      expect.objectContaining({
        status: "removed",
        candidate: expect.objectContaining({ kind: "worktree-metadata" }),
      }),
    ]);

    // The same sweep where prune keeps the entry: the list still has it.
    const kept = await runSweep([gone]);
    expect(kept.result.actions).toEqual([
      expect.objectContaining({
        status: "failed",
        detail: "git worktree prune kept this entry",
      }),
    ]);
    expect(kept.keepCategory("gone")).toBe("removal failed");

    const dryRun = await runSweep([gone], { apply: false });
    expect(dryRun.result.actions[0]?.status).toBe("planned");
  });

  it("does not offer to prune a missing worktree that is locked", async () => {
    const { result, keepCategory } = await runSweep([
      { ...gone, lock: "on the external drive" },
      { ...gone, name: "gone-pool", lock: "Herdr worktree pool" },
    ]);
    expect(result.candidates).toEqual([]);
    expect(keepCategory("gone")).toBe("locked, directory missing");
    expect(keepCategory("gone-pool")).toBe("locked, directory missing");
  });

  it("records a keep for every worktree of a repository with no default branch", async () => {
    const { result, keepCategory } = await runSweep(
      [
        { name: "one", ageDays: 30 },
        { name: "two", branch: "feat/two", ageDays: 30 },
      ],
      {
        override: (command) =>
          command.argv.includes("symbolic-ref")
            ? { exitCode: 1, stdout: "", stderr: "not a symbolic ref" }
            : undefined,
      },
    );
    expect(result.inspectedCount).toBe(2);
    expect(result.decisions).toHaveLength(2);
    expect(keepCategory("one")).toBe("default branch unknown");
    expect(keepCategory("two")).toBe("default branch unknown");
    expect(result.candidates).toEqual([]);
  });
});

describe("sweepWorktrees unknown directories", () => {
  it("reports directories git has no worktree for and leaves them in place", async () => {
    let stray = "";
    let orphan = "";
    const { result } = await runSweep(
      [
        {
          name: "known",
          relativeDir: ".herdr/worktrees/monorepo/known",
          ageDays: 1,
        },
        {
          name: "nested",
          relativeDir: ".herdr/worktrees/monorepo/group/nested",
          ageDays: 1,
        },
      ],
      {
        prepare: async (repo) => {
          stray = path.join(
            repo.root,
            ".herdr",
            "worktrees",
            "monorepo",
            "stray",
          );
          orphan = path.join(repo.repoPath, ".claude", "worktrees", "orphan");
          await Bun.write(path.join(stray, "notes.txt"), "keep me");
          await Bun.write(path.join(orphan, "notes.txt"), "keep me");
          // What a removed worktree leaves behind: not reported, and cleared.
          await mkdir(path.join(path.dirname(stray), "leftover"));
        },
      },
    );
    expect(result.warnings).toEqual([
      `Not a git worktree, left in place: ${stray}`,
      `Not a git worktree, left in place: ${orphan}`,
    ]);
    expect(await Bun.file(path.join(stray, "notes.txt")).text()).toBe(
      "keep me",
    );
    expect(await Bun.file(path.join(orphan, "notes.txt")).text()).toBe(
      "keep me",
    );
    expect(
      await directoryExists(path.join(path.dirname(stray), "leftover")),
    ).toBe(false);
  });
});
