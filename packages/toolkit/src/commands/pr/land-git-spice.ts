import { z } from "zod";
import type { CiObserver } from "#lib/ci/observer.ts";
import { tryGithubToken } from "#lib/ci/process.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import { populateGitSpiceEnvironment } from "#lib/git-spice/env.ts";
import {
  gitExecutable,
  readSpiceBranches,
  readSpiceRepoConfig,
} from "#lib/git-spice/spice-state.ts";
import {
  buildPassthroughInvocation,
  lookupExecutable,
} from "#lib/passthrough.ts";
import { spawnCapture, type CapturedResult } from "#lib/spawn-capture.ts";

type EnvMap = Readonly<Record<string, string | undefined>>;

export type GitCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<CapturedResult>;

export type MergeTarget = {
  readonly number: number;
  readonly branch: string;
  readonly headSha: string;
  readonly baseRef: string;
};

export type MergePreparation =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reasons: string[];
      readonly commands: string[];
    };

export type TrackBranchResult = {
  readonly code: number;
  readonly stderr: string;
};

export type TrackBranchFn = (
  branch: string,
  base: string,
  cwd: string,
  signal: AbortSignal,
) => Promise<TrackBranchResult>;

const LandPullSchema = z.object({
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string(), sha: z.string() }),
});

/** Sanitize, trim, and bound merge stderr so JSON reports include actionable failure context. */
export function formatMergeStderr(stderr: string): string | null {
  const cleaned = sanitizeText(stderr).trim();
  if (cleaned.length === 0) return null;
  const lines = cleaned.split(/\r?\n/u).slice(-20).join("\n");
  return lines.length > 2000 ? lines.slice(-2000) : lines;
}

async function teeStreamToStderr(
  stream: ReadableStream<Uint8Array>,
  captured?: string[],
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    process.stderr.write(chunk);
    captured?.push(decoder.decode(chunk, { stream: true }));
  }
  captured?.push(decoder.decode());
}

async function resolveGitSpiceSpawn(
  args: readonly string[],
  environment: EnvMap,
): Promise<{
  executable: string;
  args: readonly string[];
  env: Record<string, string | undefined>;
}> {
  const env = await populateGitSpiceEnvironment(args, { ...environment });
  const invocation = buildPassthroughInvocation("git-spice", args, env);
  if (invocation === null) {
    throw new Error("git-spice passthrough is missing");
  }
  const executable = lookupExecutable(
    invocation.executable,
    invocation.env["PATH"],
  );
  if (executable === null) {
    throw new Error(
      `toolkit: required executable not found: ${invocation.executable}`,
    );
  }
  return { executable, args: invocation.args, env: invocation.env };
}

async function collectGitSpiceResult(
  stdout: ReadableStream<Uint8Array>,
  stderr: ReadableStream<Uint8Array>,
  exited: Promise<number>,
  teeToStderr: boolean,
): Promise<{ code: number; stderr: string }> {
  if (teeToStderr) {
    const stderrChunks: string[] = [];
    const outcomes = await Promise.all([
      teeStreamToStderr(stdout),
      teeStreamToStderr(stderr, stderrChunks),
      exited,
    ]);
    return { code: outcomes[2], stderr: stderrChunks.join("") };
  }
  const [, stderrText, code] = await Promise.all([
    new Response(stdout).text(),
    new Response(stderr).text(),
    exited,
  ]);
  return { code, stderr: stderrText };
}

async function runGitSpiceSubprocess(options: {
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly environment: EnvMap;
  readonly cwd?: string | undefined;
  readonly teeToStderr?: boolean | undefined;
}): Promise<{ code: number; stderr: string }> {
  const { args, signal, environment, cwd, teeToStderr = false } = options;
  signal.throwIfAborted();
  const resolved = await resolveGitSpiceSpawn(args, environment);
  signal.throwIfAborted();
  const child = Bun.spawn([resolved.executable, ...resolved.args], {
    ...(cwd === undefined ? {} : { cwd }),
    env: resolved.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const abort = () => {
    child.kill();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await collectGitSpiceResult(
      child.stdout,
      child.stderr,
      child.exited,
      teeToStderr,
    );
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function spawnGitSpiceMergeProcess(options: {
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly environment?: EnvMap | undefined;
}): Promise<{ code: number; stderr: string }> {
  const { args, signal, environment = Bun.env } = options;
  signal.throwIfAborted();
  const existing = environment["GH_TOKEN"]?.trim();
  const resolved =
    existing !== undefined && existing.length > 0
      ? existing
      : await tryGithubToken({ ...environment });
  return runGitSpiceSubprocess({
    args,
    signal,
    environment: {
      ...environment,
      ...(resolved === null ? {} : { GH_TOKEN: resolved }),
    },
    teeToStderr: true,
  });
}

function defaultGitRunner(env: EnvMap): GitCommandRunner {
  const git = gitExecutable(env);
  return (args, cwd) => spawnCapture([git, ...args], { cwd, env });
}

function parseAheadBehind(stdout: string): {
  ahead: number;
  behind: number;
} | null {
  const [leftText, rightText] = stdout.trim().split(/\s+/u);
  const ahead =
    leftText === undefined ? Number.NaN : Number.parseInt(leftText, 10);
  const behind =
    rightText === undefined ? Number.NaN : Number.parseInt(rightText, 10);
  if (!Number.isInteger(ahead) || ahead < 0) return null;
  return Number.isInteger(behind) && behind >= 0 ? { ahead, behind } : null;
}

export async function checkLocalBranchSync(options: {
  readonly number: number;
  readonly branch: string;
  readonly expectedHeadSha: string;
  readonly remote: string;
  readonly cwd: string;
  readonly env?: EnvMap | undefined;
  readonly runGit?: GitCommandRunner | undefined;
}): Promise<
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly message: string;
      readonly syncCommand: string;
    }
> {
  const env = options.env ?? Bun.env;
  const runGit = options.runGit ?? defaultGitRunner(env);
  const { number, branch, expectedHeadSha, remote, cwd } = options;
  const localRef = await runGit(
    ["rev-parse", "--verify", `refs/heads/${branch}^{commit}`],
    cwd,
  );
  if (localRef.exitCode !== 0 || localRef.stdout.trim().length === 0) {
    const syncCommand = `git fetch ${remote} ${branch}:${branch}`;
    return {
      ok: false,
      message: `Local branch '${branch}' for PR #${String(number)} does not exist in this checkout. Sync the worktree with: ${syncCommand}`,
      syncCommand,
    };
  }
  const localSha = localRef.stdout.trim();
  if (localSha === expectedHeadSha) {
    return { ok: true };
  }
  const hasRemoteCommit = await runGit(
    ["cat-file", "-e", `${expectedHeadSha}^{commit}`],
    cwd,
  );
  if (hasRemoteCommit.exitCode !== 0) {
    await runGit(["fetch", remote, branch], cwd);
  }
  const revList = await runGit(
    ["rev-list", "--left-right", "--count", `${localSha}...${expectedHeadSha}`],
    cwd,
  );
  const counts =
    revList.exitCode === 0 ? parseAheadBehind(revList.stdout) : null;
  const syncCommand = `git fetch ${remote} && git reset --hard ${remote}/${branch}`;
  const detail =
    counts === null
      ? ""
      : `: local is ${String(counts.ahead)} ahead, ${String(counts.behind)} behind`;
  return {
    ok: false,
    message: `Local branch '${branch}' (${localSha.slice(0, 12)}) diverged from remote PR #${String(number)} head (${expectedHeadSha.slice(0, 12)})${detail}. Sync the worktree with: ${syncCommand}`,
    syncCommand,
  };
}

export async function runGitSpiceTrackBranch(options: {
  readonly branch: string;
  readonly base: string;
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly environment?: EnvMap | undefined;
}): Promise<TrackBranchResult> {
  const { branch, base, cwd, signal, environment = Bun.env } = options;
  return runGitSpiceSubprocess({
    args: ["-C", cwd, "branch", "track", "--no-prompt", "--base", base, branch],
    cwd,
    signal,
    environment,
  });
}

export async function preflightGitSpiceLand(options: {
  readonly number: number;
  readonly observer: CiObserver;
  readonly signal: AbortSignal;
  readonly cwd?: string | undefined;
  readonly env?: EnvMap | undefined;
  readonly runGit?: GitCommandRunner | undefined;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? Bun.env;
  const runGit = options.runGit ?? defaultGitRunner(env);
  const { number, observer, signal } = options;
  signal.throwIfAborted();

  const mergeSetting = await runGit(
    ["config", "--type=bool", "--get", "spice.experiment.merge"],
    cwd,
  );
  if (mergeSetting.exitCode !== 0 || mergeSetting.stdout.trim() !== "true") {
    throw new Error(
      "git-spice merge experiment is not enabled in this checkout. Run: git config --local spice.experiment.merge true",
    );
  }

  const repoConfig = await readSpiceRepoConfig(cwd, env);
  if (repoConfig === null) {
    throw new Error(
      "git-spice is not initialized in this checkout. Run: toolkit git-spice repo init --trunk main --remote origin",
    );
  }

  const pr = await observer.github.read(
    `/repos/${observer.github.repo}/pulls/${String(number)}`,
    LandPullSchema,
    signal,
  );
  if (pr.state === "closed" || pr.merged) {
    return;
  }

  const branch = pr.head.ref;
  const base = pr.base.ref;
  const branches = await readSpiceBranches(cwd, env);
  const tracked = branches.get(branch);
  const remedy = `toolkit git-spice branch track --base ${base} ${branch} && toolkit git-spice branch submit --branch ${branch} --update-only --no-prompt`;
  if (tracked === undefined) {
    throw new Error(
      `Branch '${branch}' for PR #${String(number)} is not tracked by git-spice in this checkout. Run: ${remedy}`,
    );
  }
  if (tracked.prNumber !== number) {
    const found =
      tracked.prNumber === undefined ? "none" : `#${String(tracked.prNumber)}`;
    throw new Error(
      `Branch '${branch}' is tracked locally without PR #${String(number)} associated in git-spice metadata (found ${found}). Run: ${remedy}`,
    );
  }

  const remote = repoConfig.remote.length > 0 ? repoConfig.remote : "origin";
  const sync = await checkLocalBranchSync({
    number,
    branch,
    expectedHeadSha: pr.head.sha,
    remote,
    cwd,
    env,
    runGit,
  });
  if (!sync.ok) {
    throw new Error(sync.message);
  }
}

export async function prepareGitSpiceMerge(
  target: MergeTarget,
  signal: AbortSignal,
  options: {
    readonly cwd?: string | undefined;
    readonly env?: EnvMap | undefined;
    readonly runGit?: GitCommandRunner | undefined;
    readonly trackBranch?: TrackBranchFn | undefined;
  } = {},
): Promise<MergePreparation> {
  signal.throwIfAborted();
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? Bun.env;
  const repoConfig = await readSpiceRepoConfig(cwd, env);
  const remote =
    repoConfig !== null && repoConfig.remote.length > 0
      ? repoConfig.remote
      : "origin";

  const sync = await checkLocalBranchSync({
    number: target.number,
    branch: target.branch,
    expectedHeadSha: target.headSha,
    remote,
    cwd,
    env,
    runGit: options.runGit,
  });
  if (!sync.ok) {
    return {
      ok: false,
      reasons: [sync.message],
      commands: [sync.syncCommand, `toolkit pr land ${String(target.number)}`],
    };
  }

  if (repoConfig === null) {
    return { ok: true };
  }
  const trunk = repoConfig.trunk.length > 0 ? repoConfig.trunk : "main";
  const branches = await readSpiceBranches(cwd, env);
  const localBase = branches.get(target.branch)?.baseName;
  if (
    localBase === undefined ||
    localBase === "" ||
    localBase === trunk ||
    target.baseRef !== trunk
  ) {
    return { ok: true };
  }

  const track =
    options.trackBranch ??
    ((branch, base, dir, abortSignal) =>
      runGitSpiceTrackBranch({
        branch,
        base,
        cwd: dir,
        signal: abortSignal,
        environment: env,
      }));
  const outcome = await track(target.branch, trunk, cwd, signal);
  signal.throwIfAborted();
  if (outcome.code !== 0) {
    const detail = formatMergeStderr(outcome.stderr);
    return {
      ok: false,
      reasons: [
        `Branch '${target.branch}' targets '${trunk}' on GitHub, but local git-spice metadata still tracks '${localBase}' as its base and retargeting exited ${String(outcome.code)}.`,
        ...(detail === null ? [] : [detail]),
      ],
      commands: [
        `toolkit git-spice branch track --base ${trunk} ${target.branch}`,
        `toolkit pr land ${String(target.number)}`,
      ],
    };
  }
  console.error(
    `Retargeted local git-spice base of '${target.branch}' from '${localBase}' to '${trunk}'.`,
  );
  return { ok: true };
}
