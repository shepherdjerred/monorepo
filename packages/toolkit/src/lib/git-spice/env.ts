import os from "node:os";
import path from "node:path";
import {
  GUI_DELEGATED_ENVIRONMENT,
  isUnreachableLoginKeychainError,
  missingKeychainItemError,
} from "#lib/credential-gui-bridge.ts";
import { lookupExecutable } from "#lib/passthrough.ts";
import { spawnCapture } from "#lib/spawn-capture.ts";
import {
  isForgeCommand,
  parseGitSpiceArgs,
  shouldSkipGitSpiceToken,
} from "./spice-args.ts";

export type CommandRunner = (
  argv: string[],
  extraEnvironment?: Readonly<Record<string, string>>,
) => Promise<{ exit: number; stdout: string; stderr: string }>;

export type PopulateGitSpiceEnvOptions = {
  readonly platform?: NodeJS.Platform | undefined;
  readonly run?: CommandRunner | undefined;
  readonly ghExecutable?: string | undefined;
  readonly herdrCorePath?: string | null | undefined;
};

function createDefaultRunner(
  baseEnvironment: Readonly<Record<string, string | undefined>>,
): CommandRunner {
  return async (argv, extraEnvironment = {}) => {
    const env: Record<string, string | undefined> = {
      ...baseEnvironment,
      ...extraEnvironment,
    };
    delete env["OP_SERVICE_ACCOUNT_TOKEN"];
    const result = await spawnCapture(argv, { env });
    return {
      exit: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

function defaultHerdrCorePath(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const home =
    env["HOME"] !== undefined && env["HOME"].length > 0
      ? env["HOME"]
      : os.homedir();
  return path.join(home, ".local", "bin", "herdr-core");
}

async function isNonGuiLaunchdSession(run: CommandRunner): Promise<boolean> {
  const keychainProbe = await missingKeychainItemError(
    run,
    new Error("gh auth token failed"),
  );
  if (isUnreachableLoginKeychainError(keychainProbe)) {
    return true;
  }
  const session = await run(["launchctl", "managername"]);
  const manager = session.exit === 0 ? session.stdout.trim() : "";
  return manager.length > 0 && manager !== "Aqua";
}

async function resolveGhTokenViaGuiBridge(options: {
  readonly run: CommandRunner;
  readonly ghExecutable: string;
  readonly herdrCorePath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly checkHerdrCoreExists: boolean;
}): Promise<string | null> {
  const { run, ghExecutable, herdrCorePath, env, checkHerdrCoreExists } =
    options;
  if (env[GUI_DELEGATED_ENVIRONMENT] === "1") return null;
  if (!(await isNonGuiLaunchdSession(run))) return null;
  if (checkHerdrCoreExists && !(await Bun.file(herdrCorePath).exists())) {
    return null;
  }

  const status = await run([herdrCorePath, "server", "status", "--json"]);
  if (status.exit !== 0) return null;

  const forwardedEnvArgs: string[] = [
    "--env",
    `${GUI_DELEGATED_ENVIRONMENT}=1`,
  ];
  const ghConfigDir = env["GH_CONFIG_DIR"]?.trim();
  if (ghConfigDir !== undefined && ghConfigDir.length > 0) {
    forwardedEnvArgs.push("--env", `GH_CONFIG_DIR=${ghConfigDir}`);
  }
  const ghHost = env["GH_HOST"]?.trim();
  if (ghHost !== undefined && ghHost.length > 0) {
    forwardedEnvArgs.push("--env", `GH_HOST=${ghHost}`);
  }

  const delegated = await run([
    herdrCorePath,
    "exec",
    ...forwardedEnvArgs,
    ghExecutable,
    "auth",
    "token",
  ]);
  const token = delegated.exit === 0 ? delegated.stdout.trim() : "";
  return token.length > 0 ? token : null;
}

async function resolveGhAuthToken(
  env: Readonly<Record<string, string | undefined>>,
  options: PopulateGitSpiceEnvOptions,
): Promise<string | null> {
  const run = options.run ?? createDefaultRunner(env);
  const gh =
    options.ghExecutable ??
    lookupExecutable("gh", env["PATH"], env["HOME"]) ??
    "gh";

  let direct: { exit: number; stdout: string; stderr: string };
  try {
    direct = await run([gh, "auth", "token"]);
  } catch {
    return null;
  }
  const directToken = direct.exit === 0 ? direct.stdout.trim() : "";
  if (directToken.length > 0) {
    return directToken;
  }

  const platform = options.platform ?? process.platform;
  if (platform !== "darwin" || options.herdrCorePath === null) {
    return null;
  }

  const herdrCorePath = options.herdrCorePath ?? defaultHerdrCorePath(env);
  try {
    return await resolveGhTokenViaGuiBridge({
      run,
      ghExecutable: gh,
      herdrCorePath,
      env,
      checkHerdrCoreExists:
        options.herdrCorePath === undefined && options.run === undefined,
    });
  } catch {
    return null;
  }
}

/**
 * Populate `GITHUB_TOKEN` for `git-spice` when unset and `--github-token` is
 * not passed, skipping metadata, shell, and `auth` subcommands (`auth login`
 * refuses to run when `GITHUB_TOKEN` is set).
 */
export async function populateGitSpiceEnvironment(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  options: PopulateGitSpiceEnvOptions = {},
): Promise<Record<string, string | undefined>> {
  const env: Record<string, string | undefined> = { ...environment };
  if (shouldSkipGitSpiceToken(args)) {
    return env;
  }

  const parsed = parseGitSpiceArgs(args);
  if (parsed.hasGithubTokenFlag) {
    return env;
  }

  const existingGithubToken = env["GITHUB_TOKEN"]?.trim();
  if (existingGithubToken !== undefined && existingGithubToken.length > 0) {
    return env;
  }

  const ambientGhToken = env["GH_TOKEN"]?.trim();
  if (ambientGhToken !== undefined && ambientGhToken.length > 0) {
    env["GITHUB_TOKEN"] = ambientGhToken;
    return env;
  }

  if (!isForgeCommand(args)) {
    return env;
  }

  const resolved = await resolveGhAuthToken(env, options);
  if (resolved !== null) {
    env["GITHUB_TOKEN"] = resolved;
  }
  return env;
}

export function readPopulatedGitSpiceToken(
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const token = env["GITHUB_TOKEN"]?.trim() ?? env["GH_TOKEN"]?.trim();
  return token !== undefined && token.length > 0 ? token : undefined;
}
