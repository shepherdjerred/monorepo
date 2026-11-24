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

type Env = Readonly<Record<string, string | undefined>>;

export type BranchCreateOptions = {
  readonly cwd?: string | undefined;
  readonly stdoutToStderr?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: "inherit" | "ignore" | undefined;
};

type BranchCreatePlan = {
  readonly reparentNewBranchToTrunk: boolean;
  readonly checkoutSeedRef?: string | undefined;
};

type SpiceOpContext = {
  readonly invocation: PassthroughInvocation;
  readonly cwd: string;
  readonly trunk: string;
  readonly currentBranch: string;
  readonly options: BranchCreateOptions;
};

function hasTargetDependentInsertFlag(args: readonly string[]): boolean {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  return head.some(
    (token) =>
      token === "--below" ||
      token.startsWith("--below=") ||
      token === "--insert" ||
      token.startsWith("--insert="),
  );
}

function matchInlineTargetToken(token: string): string | undefined {
  if (token.startsWith("--target=")) return token.slice("--target=".length);
  if (token.startsWith("-t=") && !token.startsWith("--")) return token.slice(3);
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
  env: Env,
): Promise<string | null> {
  const res = await spawnCapture(
    [gitExecutable(env), "branch", "--show-current"],
    {
      cwd,
      env,
    },
  );
  const trimmed = res.exitCode === 0 ? res.stdout.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

async function refExists(cwd: string, ref: string, env: Env): Promise<boolean> {
  const res = await spawnCapture(
    [gitExecutable(env), "rev-parse", "--verify", "--quiet", ref],
    { cwd, env },
  );
  return res.exitCode === 0;
}

async function countCommitsAhead(
  cwd: string,
  baseRef: string,
  headRef: string,
  env: Env,
): Promise<number | null> {
  const res = await spawnCapture(
    [gitExecutable(env), "rev-list", "--count", `${baseRef}..${headRef}`],
    { cwd, env },
  );
  if (res.exitCode !== 0) return null;
  const count = Number.parseInt(res.stdout.trim(), 10);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

async function unsetTrunkUpstreamIfPointingAtTrunk(
  cwd: string,
  branch: string,
  trunk: string,
  env: Env,
): Promise<void> {
  const mergeRef = await readGitConfig(cwd, `branch.${branch}.merge`, env);
  if (mergeRef !== `refs/heads/${trunk}`) return;
  const git = gitExecutable(env);
  const res = await spawnCapture([git, "branch", "--unset-upstream", branch], {
    cwd,
    env,
  });
  if (res.exitCode !== 0) {
    await spawnCapture([git, "config", "--unset", `branch.${branch}.merge`], {
      cwd,
      env,
    });
  }
}

function runInternalSpice(
  ctx: SpiceOpContext,
  args: readonly string[],
): Promise<number> {
  const [first = "branch", second = "track", ...rest] = args;
  return spawnPassthroughInvocation(
    {
      executable: ctx.invocation.executable,
      args: [first, second, "-C", ctx.cwd, "--no-prompt", ...rest],
      env: ctx.invocation.env,
    },
    {
      cwd: ctx.cwd,
      stdoutToStderr: ctx.options.stdoutToStderr,
      signal: ctx.options.signal,
      stdin: "ignore",
    },
  );
}

async function decideRemoteTrunkTargetPlan(
  cwd: string,
  remoteTrunkRef: string | null,
  hasRemoteTrunkRef: boolean,
  env: Env,
): Promise<BranchCreatePlan | null> {
  if (!hasRemoteTrunkRef || remoteTrunkRef === null) return null;
  const [ahead, behind] = await Promise.all([
    countCommitsAhead(cwd, remoteTrunkRef, "HEAD", env),
    countCommitsAhead(cwd, "HEAD", remoteTrunkRef, env),
  ]);
  if (ahead === null || behind === null) return null;
  return ahead === 0 && behind === 0
    ? { reparentNewBranchToTrunk: true }
    : { reparentNewBranchToTrunk: true, checkoutSeedRef: remoteTrunkRef };
}

async function decideLocalTrunkTargetPlan(params: {
  readonly cwd: string;
  readonly trunk: string;
  readonly comparisonBaseRef: string;
  readonly trunkInAnotherWorktree: boolean;
  readonly env: Env;
}): Promise<BranchCreatePlan | null> {
  const { cwd, trunk, comparisonBaseRef, trunkInAnotherWorktree, env } = params;
  const localTrunkRef = `refs/heads/${trunk}`;
  const [aheadOfComp, aheadOfLocal, behindLocal] = await Promise.all([
    countCommitsAhead(cwd, comparisonBaseRef, "HEAD", env),
    countCommitsAhead(cwd, localTrunkRef, "HEAD", env),
    countCommitsAhead(cwd, "HEAD", localTrunkRef, env),
  ]);
  if (aheadOfComp === null || aheadOfLocal === null) return null;
  if (aheadOfComp === 0) {
    return trunkInAnotherWorktree || aheadOfLocal > 0
      ? { reparentNewBranchToTrunk: true }
      : null;
  }
  if (!trunkInAnotherWorktree) return null;
  return aheadOfLocal === 0 && behindLocal === 0
    ? { reparentNewBranchToTrunk: true }
    : { reparentNewBranchToTrunk: true, checkoutSeedRef: localTrunkRef };
}

async function decideBranchCreatePlan(options: {
  readonly target: string | undefined;
  readonly wasCurrentTracked: boolean;
  readonly cwd: string;
  readonly trunk: string;
  readonly remote: string;
  readonly remoteTrunkRef: string | null;
  readonly hasRemoteTrunkRef: boolean;
  readonly comparisonBaseRef: string;
  readonly worktrees: readonly WorktreeEntry[];
  readonly toplevel: string | null;
  readonly env: Env;
}): Promise<BranchCreatePlan | null> {
  const { target, wasCurrentTracked, cwd, trunk, remote, env } = options;
  if (target === undefined) {
    if (wasCurrentTracked) return null;
    const ahead = await countCommitsAhead(
      cwd,
      options.comparisonBaseRef,
      "HEAD",
      env,
    );
    return ahead === null ? null : { reparentNewBranchToTrunk: ahead === 0 };
  }
  if (remote.length > 0 && target === `${remote}/${trunk}`) {
    return decideRemoteTrunkTargetPlan(
      cwd,
      options.remoteTrunkRef,
      options.hasRemoteTrunkRef,
      env,
    );
  }
  if (target !== trunk) return null;
  const trunkInAnotherWorktree = options.worktrees.some(
    (wt) =>
      (options.toplevel === null || wt.realPath !== options.toplevel) &&
      wt.branch === trunk,
  );
  return decideLocalTrunkTargetPlan({
    cwd,
    trunk,
    comparisonBaseRef: options.comparisonBaseRef,
    trunkInAnotherWorktree,
    env,
  });
}

async function cleanupSeedBranch(
  ctx: SpiceOpContext,
  seedBranch: string,
  afterBranch: string | null,
): Promise<void> {
  const git = gitExecutable(ctx.invocation.env);
  if (afterBranch === seedBranch) {
    await spawnCapture([git, "checkout", ctx.currentBranch], {
      cwd: ctx.cwd,
      env: ctx.invocation.env,
    });
  }
  await runInternalSpice(ctx, ["branch", "untrack", seedBranch]);
  await spawnCapture([git, "branch", "-D", seedBranch], {
    cwd: ctx.cwd,
    env: ctx.invocation.env,
  });
}

async function prepareBaseForCreate(
  ctx: SpiceOpContext,
  plan: BranchCreatePlan,
  wasCurrentTracked: boolean,
): Promise<
  { ok: true; seedBranch: string | null } | { ok: false; exitCode: number }
> {
  if (plan.checkoutSeedRef !== undefined) {
    const seedBranch = `toolkit-spice-seed-${String(process.pid)}-${String(Date.now())}`;
    const checkout = await spawnCapture(
      [
        gitExecutable(ctx.invocation.env),
        "checkout",
        "-b",
        seedBranch,
        plan.checkoutSeedRef,
      ],
      { cwd: ctx.cwd, env: ctx.invocation.env },
    );
    if (checkout.exitCode !== 0) {
      const detail = checkout.stderr.trim() || checkout.stdout.trim();
      if (detail.length > 0) console.error(detail);
      return { ok: false, exitCode: checkout.exitCode };
    }
    const trackSeed = await runInternalSpice(ctx, [
      "branch",
      "track",
      "--base",
      ctx.trunk,
      seedBranch,
    ]);
    if (trackSeed !== 0) {
      await cleanupSeedBranch(ctx, seedBranch, seedBranch);
      return { ok: false, exitCode: trackSeed };
    }
    return { ok: true, seedBranch };
  }
  if (!wasCurrentTracked) {
    const trackExit = await runInternalSpice(ctx, [
      "branch",
      "track",
      "--base",
      ctx.trunk,
      ctx.currentBranch,
    ]);
    if (trackExit !== 0) return { ok: false, exitCode: trackExit };
  }
  return { ok: true, seedBranch: null };
}

async function cleanupBaseAfterCreate(
  ctx: SpiceOpContext,
  seedBranch: string | null,
  afterBranch: string | null,
  state: { wasCurrentTracked: boolean; reparentNewBranchToTrunk: boolean },
): Promise<void> {
  if (seedBranch !== null) {
    await cleanupSeedBranch(ctx, seedBranch, afterBranch);
  } else if (!state.reparentNewBranchToTrunk) {
    await unsetTrunkUpstreamIfPointingAtTrunk(
      ctx.cwd,
      ctx.currentBranch,
      ctx.trunk,
      ctx.invocation.env,
    );
  } else if (!state.wasCurrentTracked) {
    await runInternalSpice(ctx, ["branch", "untrack", ctx.currentBranch]);
  }
}

async function reconcileAfterBranchCreate(
  ctx: SpiceOpContext,
  seedBranch: string | null,
  wasCurrentTracked: boolean,
  reparentNewBranchToTrunk: boolean,
): Promise<number> {
  const afterBranch = await readCurrentBranch(ctx.cwd, ctx.invocation.env);
  const created =
    afterBranch !== null &&
    afterBranch !== ctx.currentBranch &&
    afterBranch !== seedBranch &&
    afterBranch !== ctx.trunk;

  if (!created) {
    await cleanupBaseAfterCreate(ctx, seedBranch, afterBranch, {
      wasCurrentTracked,
      reparentNewBranchToTrunk: true,
    });
    return 0;
  }

  let reparentExit = 0;
  if (reparentNewBranchToTrunk) {
    reparentExit = await runInternalSpice(ctx, [
      "branch",
      "track",
      "--base",
      ctx.trunk,
      afterBranch,
    ]);
    if (reparentExit !== 0) {
      console.error(
        `toolkit git-spice: created branch '${afterBranch}', but reparenting onto '${ctx.trunk}' failed (exit ${String(reparentExit)}); run: toolkit spice branch track --base ${ctx.trunk} ${afterBranch}`,
      );
    }
  }
  await unsetTrunkUpstreamIfPointingAtTrunk(
    ctx.cwd,
    afterBranch,
    ctx.trunk,
    ctx.invocation.env,
  );
  await cleanupBaseAfterCreate(ctx, seedBranch, afterBranch, {
    wasCurrentTracked,
    reparentNewBranchToTrunk,
  });
  return reparentExit;
}

/**
 * Intercept `git-spice branch create` in agent/linked worktrees (`AI-755` /
 * `AI-2`).
 */
export async function maybeHandleBranchCreate(
  invocation: PassthroughInvocation,
  options: BranchCreateOptions = {},
): Promise<number | null> {
  if (
    !isBranchCreateCommand(invocation.args) ||
    hasTargetDependentInsertFlag(invocation.args)
  ) {
    return null;
  }

  const baseCwd = options.cwd ?? process.cwd();
  const cwd = effectiveCwd(invocation.args, baseCwd);
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
    remoteTrunkRef,
    hasRemoteTrunkRef,
    comparisonBaseRef,
    worktrees,
    toplevel,
    env: invocation.env,
  });
  if (plan === null) return null;

  const ctx: SpiceOpContext = {
    invocation,
    cwd,
    trunk,
    currentBranch,
    options,
  };
  const prep = await prepareBaseForCreate(ctx, plan, wasCurrentTracked);
  if (!prep.ok) return prep.exitCode;

  let createExit = 1;
  try {
    createExit = await spawnPassthroughInvocation(
      {
        executable: invocation.executable,
        args: strippedArgs,
        env: invocation.env,
      },
      {
        cwd: baseCwd,
        stdoutToStderr: options.stdoutToStderr,
        signal: options.signal,
        stdin: options.stdin,
      },
    );
  } finally {
    const reconcileExit = await reconcileAfterBranchCreate(
      ctx,
      prep.seedBranch,
      wasCurrentTracked,
      plan.reparentNewBranchToTrunk,
    );
    if (createExit === 0 && reconcileExit !== 0) createExit = reconcileExit;
  }
  return createExit;
}
