import { mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_WORKTREE_MIN_AGE_MS } from "#lib/tend/paths.ts";
import type {
  CommandExecOptions,
  CommandExecResult,
  CommandRunner,
  LivenessSnapshot,
} from "#lib/tend/types.ts";
import { sweepWorktrees } from "#lib/tend/worktrees.ts";
import { parseBatchPullRequests } from "#lib/tend/worktrees-git.ts";

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

function emptyLiveness(
  protectedPaths: Iterable<string> = [],
): LivenessSnapshot {
  return {
    capturedAt: "2026-11-15T20:00:00Z",
    platform: "darwin",
    localHost: "karpathy",
    localHostAliases: new Set(["karpathy"]),
    hcAvailable: true,
    hcTerminals: [],
    protectedPaths: new Set(protectedPaths),
    processCwds: new Set(),
    herdrActivePaths: new Set(),
    forumNoticePaths: new Set(),
    forumNotices: [],
    forumAvailable: true,
    holdSurfaces: new Map(),
    warnings: [],
    processes: new Map(),
    liveTerminalRelatedPids: new Set(),
  };
}

async function createWorktreeFixture(
  wtPath: string,
  gitDirPath: string,
  mtimeSeconds: number,
  extraGitFile?: string,
): Promise<void> {
  await mkdir(wtPath, { recursive: true });
  await mkdir(gitDirPath, { recursive: true });
  const dotGit = path.join(wtPath, ".git");
  const headFile = path.join(gitDirPath, "HEAD");
  const indexFile = path.join(gitDirPath, "index");
  await Bun.write(dotGit, `gitdir: ${gitDirPath}\n`);
  await Bun.write(headFile, "ref: refs/heads/test\n");
  await Bun.write(indexFile, "idx");
  if (extraGitFile !== undefined) {
    await Bun.write(path.join(gitDirPath, extraGitFile), "1");
  }
  const ts = new Date(mtimeSeconds * 1000);
  await utimes(dotGit, ts, ts);
  await utimes(headFile, ts, ts);
  await utimes(indexFile, ts, ts);
  await utimes(wtPath, ts, ts);
}

type WorktreeMockSpec = {
  readonly gitDir: string;
  readonly status: string;
  readonly commitEpoch: number;
  readonly aheadOfMain: number;
};

function dispatchMockCommand(options: {
  readonly key: string;
  readonly cwd: string;
  readonly spec: WorktreeMockSpec | undefined;
  readonly porcelain: string;
  readonly prJson: string;
}): CommandExecResult {
  const { key, cwd, spec, porcelain, prJson } = options;
  const responses: Record<string, CommandExecResult> = {
    "gh pr list": { exitCode: 0, stdout: prJson, stderr: "" },
    "git worktree list": { exitCode: 0, stdout: porcelain, stderr: "" },
    "git symbolic-ref": { exitCode: 0, stdout: "origin/main\n", stderr: "" },
    "git rev-parse --git-dir": {
      exitCode: 0,
      stdout: `${spec?.gitDir ?? cwd}\n`,
      stderr: "",
    },
    "git rev-parse --abbrev-ref": {
      exitCode: 128,
      stdout: "",
      stderr: "fatal: no upstream configured",
    },
    "git log": {
      exitCode: 0,
      stdout: `${String(spec?.commitEpoch ?? 0)}\n`,
      stderr: "",
    },
    "git status": { exitCode: 0, stdout: spec?.status ?? "", stderr: "" },
    "git rev-list": {
      exitCode: 0,
      stdout: `${String(spec?.aheadOfMain ?? 0)}\n`,
      stderr: "",
    },
  };
  return responses[key] ?? { exitCode: 0, stdout: "", stderr: "" };
}

function commandKey(argv: readonly string[]): string {
  const head = `${argv[0] ?? ""} ${argv[1] ?? ""}`.trim();
  return head === "gh pr" || head === "git worktree" || head === "git rev-parse"
    ? `${head} ${argv[2] ?? ""}`.trim()
    : head;
}

function createGitAndGhRunner(options: {
  readonly porcelain: string;
  readonly prJson: string;
  readonly specs: ReadonlyMap<string, WorktreeMockSpec>;
  readonly recordedCommands: string[][];
}): CommandRunner {
  return (
    argv: readonly string[],
    execOpts: CommandExecOptions = {},
  ): Promise<CommandExecResult> => {
    options.recordedCommands.push([...argv]);
    const cwd = execOpts.cwd ?? "";
    return Promise.resolve(
      dispatchMockCommand({
        key: commandKey(argv),
        cwd,
        spec: options.specs.get(cwd),
        porcelain: options.porcelain,
        prJson: options.prJson,
      }),
    );
  };
}

async function setupMultiWorktreeRepo(root: string) {
  const gitRoot = path.join(root, "git");
  const repoPath = path.join(gitRoot, "monorepo");
  await mkdir(path.join(repoPath, ".git", "worktrees"), { recursive: true });

  const nowSeconds = 1_760_000_000;
  const nineDaysAgo = nowSeconds - 9 * 86_400;
  const fiveDaysAgo = nowSeconds - 5 * 86_400;
  const gd = (name: string) => path.join(repoPath, ".git", "worktrees", name);

  const paths = {
    wtSquash: path.join(root, "wt-squash-merged"),
    wtDiverged: path.join(root, "wt-diverged-after-merge"),
    wtYoung: path.join(root, "wt-young-5d"),
    wtDirty: path.join(root, "wt-dirty"),
    wtRebase: path.join(root, "wt-mid-rebase"),
    wtHeld: path.join(root, "wt-held-cwd"),
    wtDetachedLocked: path.join(repoPath, ".claude", "worktrees", "agent-dead"),
  };

  await createWorktreeFixture(paths.wtSquash, gd("wt-squash"), nineDaysAgo);
  await createWorktreeFixture(paths.wtDiverged, gd("wt-diverged"), nineDaysAgo);
  await createWorktreeFixture(paths.wtYoung, gd("wt-young"), fiveDaysAgo);
  await createWorktreeFixture(paths.wtDirty, gd("wt-dirty"), nineDaysAgo);
  await createWorktreeFixture(
    paths.wtRebase,
    gd("wt-rebase"),
    nineDaysAgo,
    "rebase-merge",
  );
  await createWorktreeFixture(paths.wtHeld, gd("wt-held"), nineDaysAgo);
  await createWorktreeFixture(
    paths.wtDetachedLocked,
    gd("agent-dead"),
    nineDaysAgo,
  );

  const porcelain = [
    `worktree ${repoPath}\nHEAD aaaaaaaa\nbranch refs/heads/main`,
    `worktree ${paths.wtSquash}\nHEAD deadbeef\nbranch refs/heads/feat/squash`,
    `worktree ${paths.wtDiverged}\nHEAD feedface\nbranch refs/heads/feat/diverged`,
    `worktree ${paths.wtYoung}\nHEAD cafebabe\nbranch refs/heads/feat/young`,
    `worktree ${paths.wtDirty}\nHEAD 11112222\nbranch refs/heads/feat/dirty`,
    `worktree ${paths.wtRebase}\nHEAD 33334444\nbranch refs/heads/feat/rebase`,
    `worktree ${paths.wtHeld}\nHEAD 55556666\nbranch refs/heads/feat/held`,
    `worktree ${paths.wtDetachedLocked}\nHEAD aaaaaaaa\ndetached\nlocked`,
  ].join("\n\n");

  const nineIso = new Date(nineDaysAgo * 1000).toISOString();
  const prJson = JSON.stringify([
    {
      headRefName: "feat/squash",
      state: "MERGED",
      updatedAt: nineIso,
      headRefOid: "deadbeef",
    },
    {
      headRefName: "feat/diverged",
      state: "MERGED",
      updatedAt: new Date((nineDaysAgo - 3600) * 1000).toISOString(),
      headRefOid: "oldsha00",
    },
    {
      headRefName: "feat/young",
      state: "MERGED",
      updatedAt: new Date(fiveDaysAgo * 1000).toISOString(),
      headRefOid: "cafebabe",
    },
    {
      headRefName: "feat/dirty",
      state: "MERGED",
      updatedAt: nineIso,
      headRefOid: "11112222",
    },
    {
      headRefName: "feat/rebase",
      state: "MERGED",
      updatedAt: nineIso,
      headRefOid: "33334444",
    },
    {
      headRefName: "feat/held",
      state: "MERGED",
      updatedAt: nineIso,
      headRefOid: "55556666",
    },
  ]);

  const specs = new Map<string, WorktreeMockSpec>([
    [
      paths.wtSquash,
      {
        gitDir: gd("wt-squash"),
        status: "",
        commitEpoch: nineDaysAgo,
        aheadOfMain: 3,
      },
    ],
    [
      paths.wtDiverged,
      {
        gitDir: gd("wt-diverged"),
        status: "",
        commitEpoch: nineDaysAgo,
        aheadOfMain: 4,
      },
    ],
    [
      paths.wtYoung,
      {
        gitDir: gd("wt-young"),
        status: "",
        commitEpoch: fiveDaysAgo,
        aheadOfMain: 1,
      },
    ],
    [
      paths.wtDirty,
      {
        gitDir: gd("wt-dirty"),
        status: "?? scratch.txt\n",
        commitEpoch: nineDaysAgo,
        aheadOfMain: 0,
      },
    ],
    [
      paths.wtRebase,
      {
        gitDir: gd("wt-rebase"),
        status: "",
        commitEpoch: nineDaysAgo,
        aheadOfMain: 0,
      },
    ],
    [
      paths.wtHeld,
      {
        gitDir: gd("wt-held"),
        status: "",
        commitEpoch: nineDaysAgo,
        aheadOfMain: 1,
      },
    ],
    [
      paths.wtDetachedLocked,
      {
        gitDir: gd("agent-dead"),
        status: "",
        commitEpoch: nineDaysAgo,
        aheadOfMain: 0,
      },
    ],
  ]);

  return { gitRoot, nowMs: nowSeconds * 1000, paths, porcelain, prJson, specs };
}

describe("parseBatchPullRequests", () => {
  it("prefers OPEN PR over older MERGED PR when a branch name is reused", () => {
    const map = parseBatchPullRequests(
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
    expect(map.get("feat/reuse")?.state).toBe("OPEN");
  });
});

describe("sweepWorktrees", () => {
  it("batches gh pr list once per repo, respects 7-day floor, handles squash-merged PRs, unlocks detached agents, and protects dirty/rebase/held worktrees", async () => {
    const root = await makeTempDir();
    const { gitRoot, nowMs, paths, porcelain, prJson, specs } =
      await setupMultiWorktreeRepo(root);
    const recordedCommands: string[][] = [];
    const runner = createGitAndGhRunner({
      porcelain,
      prJson,
      specs,
      recordedCommands,
    });

    const result = await sweepWorktrees({
      liveness: emptyLiveness([paths.wtHeld]),
      runner,
      apply: true,
      worktreeMinAgeMs: DEFAULT_WORKTREE_MIN_AGE_MS,
      gitDirs: [gitRoot],
      homeDir: root,
      selfCwd: "/Users/jerred/elsewhere",
      nowMs,
    });

    const ghCalls = recordedCommands.filter(
      (cmd) => cmd[0] === "gh" && cmd[1] === "pr",
    );
    expect(ghCalls).toHaveLength(1);
    expect(result.candidates.map((c) => c.target)).toEqual([
      paths.wtSquash,
      paths.wtDetachedLocked,
    ]);
    expect(recordedCommands).toContainEqual([
      "git",
      "worktree",
      "remove",
      paths.wtSquash,
    ]);
    expect(recordedCommands).toContainEqual([
      "git",
      "branch",
      "-D",
      "feat/squash",
    ]);
    expect(recordedCommands).toContainEqual([
      "git",
      "worktree",
      "unlock",
      paths.wtDetachedLocked,
    ]);
    expect(recordedCommands).toContainEqual([
      "git",
      "worktree",
      "remove",
      paths.wtDetachedLocked,
    ]);
    expect(recordedCommands).toContainEqual(["git", "worktree", "prune"]);
  });
});
