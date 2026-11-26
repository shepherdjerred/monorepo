import { mkdir, utimes } from "node:fs/promises";
import path from "node:path";
import type {
  CommandExecOptions,
  CommandExecResult,
  CommandRunner,
  LivenessSnapshot,
} from "#lib/tend/types.ts";

export const DAY_SECONDS = 86_400;
export const NOW_SECONDS = 1_760_000_000;
export const NOW_MS = NOW_SECONDS * 1000;

export function makeLiveness(
  overrides: Partial<LivenessSnapshot> = {},
): LivenessSnapshot {
  return {
    capturedAt: "2026-11-15T20:00:00Z",
    platform: "darwin",
    localHost: "karpathy",
    localHostAliases: new Set(["karpathy"]),
    hcAvailable: true,
    hcTerminals: [],
    protectedPaths: new Set(),
    processCwds: new Set(),
    herdrActivePaths: new Set(),
    forumNoticePaths: new Set(),
    forumNotices: [],
    forumAvailable: true,
    holdSurfaces: new Map(),
    warnings: [],
    processes: new Map(),
    liveTerminalRelatedPids: new Set(),
    ...overrides,
  };
}

export type WorktreeSpec = {
  readonly name: string;
  /** Location under the fixture root; defaults to `<name>`. */
  readonly relativeDir?: string;
  /** Omit for a detached HEAD. */
  readonly branch?: string;
  readonly head?: string;
  /** `true` for a bare lock, or the lock reason. */
  readonly lock?: string | true;
  /** Age of every activity signal, in days. */
  readonly ageDays: number;
  /** `git status --porcelain -z` output. */
  readonly status?: string;
  readonly statusResult?: CommandExecResult;
  readonly ahead?: number;
  /** Extra file in the git dir, e.g. `rebase-merge`. */
  readonly marker?: string;
  /** Age of the index file when it differs from the other signals. */
  readonly indexAgeDays?: number;
};

export type WorktreeFixture = {
  readonly spec: WorktreeSpec;
  readonly path: string;
  readonly gitDir: string;
  readonly head: string;
  readonly commitEpoch: number;
};

export type RepoFixture = {
  readonly root: string;
  readonly gitRoot: string;
  readonly repoPath: string;
  readonly porcelain: string;
  readonly worktrees: ReadonlyMap<string, WorktreeFixture>;
  readonly pathOf: (name: string) => string;
};

function secondsAgo(days: number): number {
  return NOW_SECONDS - Math.round(days * DAY_SECONDS);
}

async function writeWorktreeFiles(fixture: WorktreeFixture): Promise<void> {
  const { spec } = fixture;
  await mkdir(fixture.path, { recursive: true });
  await mkdir(fixture.gitDir, { recursive: true });
  const dotGit = path.join(fixture.path, ".git");
  const headFile = path.join(fixture.gitDir, "HEAD");
  const indexFile = path.join(fixture.gitDir, "index");
  await Bun.write(dotGit, `gitdir: ${fixture.gitDir}\n`);
  await Bun.write(headFile, "ref: refs/heads/test\n");
  await Bun.write(indexFile, "idx");
  if (spec.marker !== undefined) {
    await Bun.write(path.join(fixture.gitDir, spec.marker), "1");
  }
  const stamp = new Date(secondsAgo(spec.ageDays) * 1000);
  const indexStamp = new Date(
    secondsAgo(spec.indexAgeDays ?? spec.ageDays) * 1000,
  );
  await utimes(dotGit, stamp, stamp);
  await utimes(headFile, stamp, stamp);
  await utimes(indexFile, indexStamp, indexStamp);
  await utimes(fixture.path, stamp, stamp);
}

function porcelainBlock(fixture: WorktreeFixture): string {
  const { spec } = fixture;
  const lines = [`worktree ${fixture.path}`, `HEAD ${fixture.head}`];
  lines.push(
    spec.branch === undefined ? "detached" : `branch refs/heads/${spec.branch}`,
  );
  if (spec.lock === true) {
    lines.push("locked");
  } else if (spec.lock !== undefined) {
    lines.push(`locked ${spec.lock}`);
  }
  return lines.join("\n");
}

/** A repository under `<root>/git/monorepo` whose worktrees exist on disk. */
export async function buildRepoFixture(
  root: string,
  specs: readonly WorktreeSpec[],
): Promise<RepoFixture> {
  const gitRoot = path.join(root, "git");
  const repoPath = path.join(gitRoot, "monorepo");
  await mkdir(path.join(repoPath, ".git", "worktrees"), { recursive: true });
  const worktrees = new Map<string, WorktreeFixture>();
  const blocks = [
    `worktree ${repoPath}\nHEAD aaaaaaaa\nbranch refs/heads/main`,
  ];
  for (const spec of specs) {
    const fixture: WorktreeFixture = {
      spec,
      path: path.join(root, spec.relativeDir ?? spec.name),
      gitDir: path.join(repoPath, ".git", "worktrees", spec.name),
      head: spec.head ?? `head-${spec.name}`,
      commitEpoch: secondsAgo(spec.ageDays),
    };
    await writeWorktreeFiles(fixture);
    worktrees.set(fixture.path, fixture);
    blocks.push(porcelainBlock(fixture));
  }
  return {
    root,
    gitRoot,
    repoPath,
    porcelain: blocks.join("\n\n"),
    worktrees,
    pathOf: (name) => {
      for (const fixture of worktrees.values()) {
        if (fixture.spec.name === name) {
          return fixture.path;
        }
      }
      throw new Error(`No worktree fixture named ${name}`);
    },
  };
}

export type RecordedCommand = {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

const OK: CommandExecResult = { exitCode: 0, stdout: "", stderr: "" };
const FAILED: CommandExecResult = { exitCode: 1, stdout: "", stderr: "boom" };

/** `git` arguments with global options (`-c k=v`, `-C dir`, `--flag`) removed. */
function gitSubcommand(argv: readonly string[]): string[] {
  const rest = argv.slice(1);
  while (rest.length > 0) {
    const head = rest[0] ?? "";
    if (head === "-c" || head === "-C") {
      rest.splice(0, 2);
    } else if (head.startsWith("--")) {
      rest.splice(0, 1);
    } else {
      break;
    }
  }
  return rest;
}

export type PullRequestRow = {
  readonly headRefName: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
  readonly updatedAt: string;
  readonly headRefOid?: string;
};

export type MockRunnerOptions = {
  readonly repo: RepoFixture;
  /** Rows for `gh pr list --state open`; `null` makes the query fail. */
  readonly openPrs?: readonly PullRequestRow[] | null | undefined;
  /** Rows for `gh pr list --state all`; `null` makes the query fail. */
  readonly allPrs?: readonly PullRequestRow[] | null | undefined;
  /**
   * `cwd`s of the Herdr terminals `hc ls --json` reports; `null` makes the
   * query fail. Defaults to no terminals.
   */
  readonly hcTerminalCwds?: readonly string[] | null | undefined;
  /** Return a result to replace the default response for a command. */
  readonly override?:
    ((command: RecordedCommand) => CommandExecResult | undefined) | undefined;
  readonly recorded: RecordedCommand[];
};

function hcResponse(options: MockRunnerOptions): CommandExecResult {
  if (options.hcTerminalCwds === null) {
    return FAILED;
  }
  const terminals = (options.hcTerminalCwds ?? []).map((cwd, index) => ({
    address: `t${String(index)}`,
    state: "live",
    cwd,
  }));
  return { exitCode: 0, stdout: JSON.stringify({ terminals }), stderr: "" };
}

function ghResponse(
  argv: readonly string[],
  options: MockRunnerOptions,
): CommandExecResult {
  const state = argv[argv.indexOf("--state") + 1];
  const rows = state === "open" ? options.openPrs : options.allPrs;
  return rows === null
    ? FAILED
    : { exitCode: 0, stdout: JSON.stringify(rows ?? []), stderr: "" };
}

function out(stdout: string): CommandExecResult {
  return { exitCode: 0, stdout, stderr: "" };
}

type GitResponder = (
  detail: string | undefined,
  fixture: WorktreeFixture | undefined,
  repo: RepoFixture,
) => CommandExecResult;

const GIT_RESPONDERS: Readonly<Record<string, GitResponder>> = {
  worktree: (detail, _fixture, repo) =>
    detail === "list" ? out(repo.porcelain) : OK,
  "symbolic-ref": () => out("origin/main\n"),
  "rev-parse": (detail, fixture, repo) =>
    detail === "--git-dir"
      ? out(`${fixture?.gitDir ?? repo.repoPath}\n`)
      : { exitCode: 128, stdout: "", stderr: "fatal: no upstream" },
  log: (_detail, fixture) => out(`${String(fixture?.commitEpoch ?? 0)}\n`),
  status: (_detail, fixture) =>
    fixture?.spec.statusResult ?? out(fixture?.spec.status ?? ""),
  "rev-list": (_detail, fixture) =>
    out(`${String(fixture?.spec.ahead ?? 0)}\n`),
  "write-tree": () => out("tree0001\n"),
  "commit-tree": () => out("commit0001\n"),
  "fsmonitor--daemon": () => ({
    exitCode: 1,
    stdout: "",
    stderr: "not running",
  }),
};

function gitResponse(
  sub: readonly string[],
  fixture: WorktreeFixture | undefined,
  repo: RepoFixture,
): CommandExecResult {
  const [verb, detail] = sub;
  const responder = verb === undefined ? undefined : GIT_RESPONDERS[verb];
  return responder === undefined ? OK : responder(detail, fixture, repo);
}

/** A `git`/`gh` stand-in that answers from the fixture and records calls. */
export function createMockRunner(options: MockRunnerOptions): CommandRunner {
  return (
    argv: readonly string[],
    execOpts: CommandExecOptions = {},
  ): Promise<CommandExecResult> => {
    const command: RecordedCommand = {
      argv: [...argv],
      cwd: execOpts.cwd ?? "",
      env: execOpts.env ?? {},
    };
    options.recorded.push(command);
    const overridden = options.override?.(command);
    if (overridden !== undefined) {
      return Promise.resolve(overridden);
    }
    if (argv[0] === "hc") {
      return Promise.resolve(hcResponse(options));
    }
    return Promise.resolve(
      argv[0] === "gh"
        ? ghResponse(argv, options)
        : gitResponse(
            gitSubcommand(argv),
            options.repo.worktrees.get(command.cwd),
            options.repo,
          ),
    );
  };
}

/** Recorded `git` invocations as subcommand argv, optionally for one cwd. */
export function gitCalls(
  recorded: readonly RecordedCommand[],
  cwd?: string,
): string[][] {
  return recorded
    .filter(
      (command) =>
        command.argv[0] === "git" && (cwd === undefined || command.cwd === cwd),
    )
    .map((command) => gitSubcommand(command.argv));
}
