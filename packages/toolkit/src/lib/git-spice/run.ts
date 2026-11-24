import {
  buildPassthroughInvocation,
  lookupExecutable,
  spawnPassthroughInvocation,
  type PassthroughInvocation,
} from "#lib/passthrough.ts";
import { maybeHandleBranchCreate } from "./branch-create.ts";
import {
  populateGitSpiceEnvironment,
  readPopulatedGitSpiceToken,
  type PopulateGitSpiceEnvOptions,
} from "./env.ts";
import {
  withGitHubProxy,
  type StartGitHubProxyOptions,
} from "./github-proxy.ts";
import {
  isBranchMergeSubcommand,
  runGitSpiceBranchMerge,
  type GitSpiceMergeOptions,
} from "./merge.ts";
import { maybeHandleRebaseContinue } from "./rebase-continue.ts";
import { isMergeCommand, isSubmitCommand } from "./spice-args.ts";
import { isSubmitSubcommand, runGitSpiceSubmit } from "./submit.ts";

export type GitSpiceSubcommandHook = (
  invocation: PassthroughInvocation,
  options: RunGitSpiceOptions,
) => Promise<number | null>;

export type RunGitSpiceOptions = {
  readonly cwd?: string | undefined;
  readonly stdoutToStderr?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: "inherit" | "ignore" | undefined;
  readonly envOptions?: PopulateGitSpiceEnvOptions | undefined;
  readonly proxyOptions?: StartGitHubProxyOptions | undefined;
  readonly writeStderr?: ((line: string) => void) | undefined;
  readonly throwOnMissingExecutable?: boolean | undefined;
  /** Extension hook for `submit` subcommands (wired by `submit.ts`). */
  readonly submitHook?: GitSpiceSubcommandHook | undefined;
  /** Extension hook for `merge` subcommands (wired by `merge.ts`). */
  readonly mergeHook?: GitSpiceSubcommandHook | undefined;
};

function extractExplicitGithubToken(
  args: readonly string[],
): string | undefined {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  let explicit: string | undefined;
  for (let i = 0; i < head.length; i += 1) {
    const token = head[i];
    if (token === "--github-token") {
      const next = head[i + 1];
      if (next !== undefined && next.trim().length > 0) {
        explicit = next.trim();
      }
      i += 1;
    } else if (token?.startsWith("--github-token=") === true) {
      const val = token.slice("--github-token=".length).trim();
      if (val.length > 0) explicit = val;
    }
  }
  return explicit;
}

function buildSubcommandOptions(
  activeInvocation: PassthroughInvocation,
  options: RunGitSpiceOptions,
): GitSpiceMergeOptions {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: activeInvocation.env,
    githubToken:
      extractExplicitGithubToken(activeInvocation.args) ??
      readPopulatedGitSpiceToken(activeInvocation.env),
    githubApiUrl: activeInvocation.env["GITHUB_API_URL"],
    stderr: options.writeStderr,
    spawnGitSpice: (spawnArgs, ctx) =>
      spawnPassthroughInvocation(
        {
          executable: activeInvocation.executable,
          args: spawnArgs,
          env: ctx.env,
        },
        {
          cwd: ctx.cwd,
          stdoutToStderr: options.stdoutToStderr,
          signal: options.signal,
          stdin: options.stdin,
        },
      ),
  };
}

let defaultSubmitHook: GitSpiceSubcommandHook = (activeInvocation, options) =>
  isSubmitSubcommand(activeInvocation.args)
    ? runGitSpiceSubmit(
        activeInvocation.args,
        buildSubcommandOptions(activeInvocation, options),
      )
    : Promise.resolve(null);

let defaultMergeHook: GitSpiceSubcommandHook = (activeInvocation, options) =>
  isBranchMergeSubcommand(activeInvocation.args)
    ? runGitSpiceBranchMerge(
        activeInvocation.args,
        buildSubcommandOptions(activeInvocation, options),
      )
    : Promise.resolve(null);

export function registerGitSpiceExtensionHooks(hooks: {
  readonly submitHook?: GitSpiceSubcommandHook | undefined;
  readonly mergeHook?: GitSpiceSubcommandHook | undefined;
}): void {
  if (hooks.submitHook !== undefined) {
    defaultSubmitHook = hooks.submitHook;
  }
  if (hooks.mergeHook !== undefined) {
    defaultMergeHook = hooks.mergeHook;
  }
}

export async function runGitSpiceInvocation(
  invocation: PassthroughInvocation,
  options: RunGitSpiceOptions = {},
): Promise<number> {
  const resolvedExecutable = lookupExecutable(
    invocation.executable,
    invocation.env["PATH"],
    invocation.env["HOME"] ?? Bun.env["HOME"],
  );
  if (resolvedExecutable === null) {
    const message = `toolkit: required executable not found: ${invocation.executable}`;
    if (options.throwOnMissingExecutable === true) {
      throw new Error(message);
    }
    const writeStderr =
      options.writeStderr ??
      ((line: string) => {
        console.error(line);
      });
    writeStderr(message);
    return 127;
  }

  const populatedEnv = await populateGitSpiceEnvironment(
    invocation.args,
    invocation.env,
    options.envOptions,
  );
  const baseCwd = options.cwd ?? process.cwd();

  return withGitHubProxy(
    {
      args: invocation.args,
      cwd: baseCwd,
      env: populatedEnv,
      writeStderr: options.writeStderr,
    },
    async (proxiedEnv) => {
      const activeInvocation: PassthroughInvocation = {
        executable: invocation.executable,
        args: invocation.args,
        env: proxiedEnv,
      };

      const rebaseResult = await maybeHandleRebaseContinue(activeInvocation, {
        cwd: baseCwd,
        stdoutToStderr: options.stdoutToStderr,
        signal: options.signal,
        stdin: options.stdin,
      });
      if (rebaseResult !== null) {
        return rebaseResult;
      }

      const branchCreateResult = await maybeHandleBranchCreate(
        activeInvocation,
        {
          cwd: baseCwd,
          stdoutToStderr: options.stdoutToStderr,
          signal: options.signal,
          stdin: options.stdin,
        },
      );
      if (branchCreateResult !== null) {
        return branchCreateResult;
      }

      const submitHook = options.submitHook ?? defaultSubmitHook;
      if (isSubmitCommand(activeInvocation.args)) {
        const submitResult = await submitHook(activeInvocation, options);
        if (submitResult !== null) {
          return submitResult;
        }
      }

      const mergeHook = options.mergeHook ?? defaultMergeHook;
      if (isMergeCommand(activeInvocation.args)) {
        const mergeResult = await mergeHook(activeInvocation, options);
        if (mergeResult !== null) {
          return mergeResult;
        }
      }

      return spawnPassthroughInvocation(activeInvocation, {
        cwd: baseCwd,
        stdoutToStderr: options.stdoutToStderr,
        signal: options.signal,
        stdin: options.stdin,
      });
    },
    options.proxyOptions,
  );
}

export async function runGitSpice(
  args: readonly string[],
  environment: Record<string, string | undefined> = Bun.env,
  options: RunGitSpiceOptions & {
    readonly command?: "git-spice" | "spice" | undefined;
  } = {},
): Promise<number> {
  const command = options.command ?? "git-spice";
  const invocation = buildPassthroughInvocation(command, args, environment);
  if (invocation === null) {
    throw new Error(`No passthrough registered for ${command}`);
  }
  return runGitSpiceInvocation(invocation, options);
}
