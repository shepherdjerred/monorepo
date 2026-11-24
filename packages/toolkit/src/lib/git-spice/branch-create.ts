import {
  spawnPassthroughInvocation,
  type PassthroughInvocation,
} from "#lib/passthrough.ts";
import { spawnCapture } from "#lib/spawn-capture.ts";
import { effectiveCwd, isBranchCreateCommand } from "./spice-args.ts";
import {
  gitExecutable,
  listWorktrees,
  readGitConfig,
  readSpiceBranches,
  readSpiceRepoConfig,
  resolveGitToplevel,
  type WorktreeEntry,
} from "./spice-state.ts";

export type BranchCreateOptions = {
  readonly cwd?: string | undefined;
  readonly stdoutToStderr?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: "inherit" | "ignore" | undefined;
};

function matchInlineTargetToken(token: string): string | undefined {
  if (token.startsWith("--target=")) {
    return token.slice("--target=".length);
  }
  if (token.startsWith("-t=") && !token.startsWith("--")) {
    return token.slice(3);
  }
  return token.startsWith("-t") && !token.startsWith("--") && token.length > 2
    ? token.slice(2)
    : undefined;
}

export function extractTargetFlag(args: readonly string[]): {
  readonly target: string | undefined;
  readonly strippedArgs: string[];
} {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  const tail = boundary === -1 ? [] : args.slice(boundary);
  const kept: string[] = [];
  let target: string | undefined;

  let index = 0;
  while (index < head.length) {
    const token = head[index];
    if (token === undefined) {
      index += 1;
      continue;
    }
    if (token === "-t" || token === "--target") {
      const value = head[index + 1];
      if (value !== undefined) target = value;
      index += value === undefined ? 1 : 2;
      continue;
    }
    const inlineTarget = matchInlineTargetToken(token);
    if (inlineTarget !== undefined) {
      target = inlineTarget;
      index += 1;
      continue;
    }
    kept.push(token);
    index += 1;
  }

  return { target, strippedArgs: [...kept, ...tail] };
}

async function readCurrentBranch(
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const result = await spawnCapture(
    [gitExecutable(env), "branch", "--show-current"],
    { cwd, env },
  );
  if (result.exitCode !== 0) return null;
  const trimmed = result.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function refExists(
  cwd: string,
  ref: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<boolean> {
  const result = await spawnCapture(
    [gitExecutable(env), "rev-parse", "--verify", "--quiet", ref],
    { cwd, env },
  );
  return result.exitCode === 0;
}

async function countCommitsAhead(
  cwd: string,
  baseRef: string,
  headRef: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<number | null> {
  const result = await spawnCapture(
    [gitExecutable(env), "rev-list", "--count", `${baseRef}..${headRef}`],
    { cwd, env },
  );
  if (result.exitCode !== 0) return null;
  const count = Number.parseInt(result.stdout.trim(), 10);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

async function unsetTrunkUpstreamIfPointingAtTrunk(
  cwd: string,
  branch: string,
  trunk: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const mergeRef = await readGitConfig(cwd, `branch.${branch}.merge`, env);
  if (mergeRef !== `refs/heads/${trunk}`) return;

  const git = gitExecutable(env);
  const unsetUpstream = await spawnCapture(
    [git, "branch", "--unset-upstream", branch],
    { cwd, env },
  );
  if (unsetUpstream.exitCode !== 0) {
    await spawnCapture([git, "config", "--unset", `branch.${branch}.merge`], {
      cwd,
      env,
    });
  }
}

async function runInternalSpice(params: {
  readonly invocation: PassthroughInvocation;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly options: BranchCreateOptions;
}): Promise<number> {
  const { invocation, cwd, args, options } = params;
  const [first = "branch", second = "track", ...rest] = args;
  return spawnPassthroughInvocation(
    {
      executable: invocation.executable,
      args: [first, second, "-C", cwd, "--no-prompt", ...rest],
      env: invocation.env,
    },
    {
      cwd,
      stdoutToStderr: options.stdoutToStderr,
      signal: options.signal,
      stdin: "ignore",
    },
  );
}

async function decideBranchCreatePlan(options: {
  readonly target: string | undefined;
  readonly wasCurrentTracked: boolean;
  readonly cwd: string;
  readonly trunk: string;
  readonly remote: string;
  readonly comparisonBaseRef: string;
  readonly worktrees: readonly WorktreeEntry[];
  readonly toplevel: string | null;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Promise<{ reparentNewBranchToTrunk: boolean } | null> {
  const {
    target,
    wasCurrentTracked,
    cwd,
    trunk,
    remote,
    comparisonBaseRef,
    worktrees,
    toplevel,
    env,
  } = options;

  if (target === undefined) {
    if (wasCurrentTracked) return null;
    const aheadOfBase = await countCommitsAhead(
      cwd,
      comparisonBaseRef,
      "HEAD",
      env,
    );
    return aheadOfBase === null
      ? null
      : { reparentNewBranchToTrunk: aheadOfBase === 0 };
  }

  const remoteTrunkName = remote.length > 0 ? `${remote}/${trunk}` : null;
  const isRemoteTrunkTarget =
    remoteTrunkName !== null && target === remoteTrunkName;
  if (target !== trunk && !isRemoteTrunkTarget) return null;

  const trunkInAnotherWorktree = worktrees.some(
    (wt) =>
      (toplevel === null || wt.realPath !== toplevel) && wt.branch === trunk,
  );
  const aheadOfLocalTrunk = await countCommitsAhead(
    cwd,
    `refs/heads/${trunk}`,
    "HEAD",
    env,
  );
  const localTrunkBehindHead =
    aheadOfLocalTrunk !== null && aheadOfLocalTrunk > 0;

  return trunkInAnotherWorktree || localTrunkBehindHead || isRemoteTrunkTarget
    ? { reparentNewBranchToTrunk: true }
    : null;
}

async function reconcileAfterBranchCreate(options: {
  readonly invocation: PassthroughInvocation;
  readonly cwd: string;
  readonly trunk: string;
  readonly currentBranch: string;
  readonly wasCurrentTracked: boolean;
  readonly reparentNewBranchToTrunk: boolean;
  readonly spawnOptions: BranchCreateOptions;
}): Promise<void> {
  const {
    invocation,
    cwd,
    trunk,
    currentBranch,
    wasCurrentTracked,
    reparentNewBranchToTrunk,
    spawnOptions,
  } = options;
  const afterBranch = await readCurrentBranch(cwd, invocation.env);
  const createdNewBranch =
    afterBranch !== null &&
    afterBranch !== currentBranch &&
    afterBranch !== trunk;

  if (!createdNewBranch) {
    if (!wasCurrentTracked) {
      await runInternalSpice({
        invocation,
        cwd,
        args: ["branch", "untrack", currentBranch],
        options: spawnOptions,
      });
    }
    return;
  }

  if (reparentNewBranchToTrunk) {
    await runInternalSpice({
      invocation,
      cwd,
      args: ["branch", "track", "--base", trunk, afterBranch],
      options: spawnOptions,
    });
  }
  await unsetTrunkUpstreamIfPointingAtTrunk(
    cwd,
    afterBranch,
    trunk,
    invocation.env,
  );

  if (!reparentNewBranchToTrunk) {
    await unsetTrunkUpstreamIfPointingAtTrunk(
      cwd,
      currentBranch,
      trunk,
      invocation.env,
    );
  } else if (!wasCurrentTracked) {
    await runInternalSpice({
      invocation,
      cwd,
      args: ["branch", "untrack", currentBranch],
      options: spawnOptions,
    });
  }
}

/**
 * Intercept `git-spice branch create` in agent/linked worktrees (`AI-755` /
 * `AI-2`).
 */
export async function maybeHandleBranchCreate(
  invocation: PassthroughInvocation,
  options: BranchCreateOptions = {},
): Promise<number | null> {
  if (!isBranchCreateCommand(invocation.args)) return null;

  const cwd = effectiveCwd(invocation.args, options.cwd ?? process.cwd());
  const repoConfig = await readSpiceRepoConfig(cwd, invocation.env);
  if (repoConfig === null) return null;

  const { trunk, remote } = repoConfig;
  const currentBranch = await readCurrentBranch(cwd, invocation.env);
  if (currentBranch === null || currentBranch === trunk) return null;

  const { target, strippedArgs } = extractTargetFlag(invocation.args);
  const remoteTrunkRef =
    remote.length > 0 ? `refs/remotes/${remote}/${trunk}` : null;

  const [branches, worktrees, toplevel, hasRemoteTrunkRef] = await Promise.all([
    readSpiceBranches(cwd, invocation.env),
    listWorktrees(cwd, invocation.env),
    resolveGitToplevel(cwd, invocation.env),
    remoteTrunkRef === null
      ? Promise.resolve(false)
      : refExists(cwd, remoteTrunkRef, invocation.env),
  ]);

  const wasCurrentTracked = branches.has(currentBranch);
  const comparisonBaseRef =
    hasRemoteTrunkRef && remoteTrunkRef !== null
      ? remoteTrunkRef
      : `refs/heads/${trunk}`;

  const plan = await decideBranchCreatePlan({
    target,
    wasCurrentTracked,
    cwd,
    trunk,
    remote,
    comparisonBaseRef,
    worktrees,
    toplevel,
    env: invocation.env,
  });
  if (plan === null) return null;

  if (!wasCurrentTracked) {
    const trackExit = await runInternalSpice({
      invocation,
      cwd,
      args: ["branch", "track", "--base", trunk, currentBranch],
      options,
    });
    if (trackExit !== 0) return trackExit;
  }

  try {
    return await spawnPassthroughInvocation(
      {
        executable: invocation.executable,
        args: strippedArgs,
        env: invocation.env,
      },
      {
        cwd,
        stdoutToStderr: options.stdoutToStderr,
        signal: options.signal,
        stdin: options.stdin,
      },
    );
  } finally {
    await reconcileAfterBranchCreate({
      invocation,
      cwd,
      trunk,
      currentBranch,
      wasCurrentTracked,
      reparentNewBranchToTrunk: plan.reparentNewBranchToTrunk,
      spawnOptions: options,
    });
  }
}
