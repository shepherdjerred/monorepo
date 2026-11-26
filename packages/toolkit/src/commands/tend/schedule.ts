import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  HOMEBREW_JOB_PATH,
  assertDarwin,
  installLaunchAgentJob,
  launchAgentJobStatus,
  launchAgentLogPaths,
  parseLaunchAgentEnvironment,
  selfArgv,
  uninstallLaunchAgentJob,
  type LaunchAgentSpec,
} from "#lib/launchd.ts";
import { resolveTendPaths, type TendPaths } from "#lib/tend/paths.ts";

export const TEND_LAUNCH_AGENT_LABEL = "com.jerred.toolkit-tend";
/** Daily at 04:30 local time, when a workstation is least likely in use. */
const DAILY_AT = { hour: 4, minute: 30 } as const;
const DAILY_AT_TEXT = "04:30";

/**
 * What the daily job runs: reap idle worktrees, then share what is identical
 * between the ones that are left.
 */
const TEND_SCHEDULE_ARGS = [
  "tend",
  "run",
  "--apply",
  "--only",
  "worktrees,dedupe",
] as const;

/**
 * The `gh` configuration directory the job is told to use, if any.
 *
 * The reaper asks `gh` which branches have pull requests, and keeps every
 * branch worktree with commits ahead when `gh` cannot answer. launchd passes
 * nothing on from the shell that installed the job, so without this the job
 * would use `gh`'s default configuration, which on an agent host need not
 * hold a valid login. The directory installed from wins; failing that, the
 * agents' own directory when it holds a login. Only the directory's path is
 * carried, never a token.
 */
export async function resolveScheduleGhConfigDir(options: {
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fileExists: (filePath: string) => Promise<boolean>;
}): Promise<string | undefined> {
  const fromShell = options.env["GH_CONFIG_DIR"];
  if (fromShell !== undefined && fromShell !== "") {
    return path.resolve(fromShell);
  }
  const agentDir = path.join(options.homeDir, ".config", "gh-agent");
  const hasLogin = await options.fileExists(path.join(agentDir, "hosts.yml"));
  return hasLogin ? agentDir : undefined;
}

/**
 * The reaper is a per-user LaunchAgent, not a Temporal Schedule: it acts on
 * one workstation's local checkouts and reads that login session's Herdr
 * terminals, processes and `gh` credentials.
 */
export function tendLaunchAgent(
  paths: TendPaths,
  homeDir: string,
  ghConfigDir?: string,
): LaunchAgentSpec {
  return {
    label: TEND_LAUNCH_AGENT_LABEL,
    plistPath: path.join(
      homeDir,
      "Library",
      "LaunchAgents",
      `${TEND_LAUNCH_AGENT_LABEL}.plist`,
    ),
    programArguments: selfArgv([...TEND_SCHEDULE_ARGS]),
    logsDir: path.join(paths.rootDir, "logs"),
    keepAlive: false,
    // A calendar time, not an interval: launchd drops an interval firing that
    // falls while the machine sleeps, but runs a missed calendar firing at
    // the next wake.
    startCalendarInterval: DAILY_AT,
    // Loading the agent must not remove anything: the first sweep is the
    // next scheduled one, after the candidates have been looked at by hand.
    runAtLoad: false,
    // launchd's own PATH has neither `gh` (Homebrew) nor `hc` (~/.local/bin),
    // and a sweep that cannot see Herdr sessions holds itself.
    environment: {
      PATH: `${path.join(homeDir, ".local", "bin")}:${HOMEBREW_JOB_PATH}`,
      // launchd passes nothing on from the shell that installed the job. An
      // overridden state directory has to travel with it, or the job would
      // keep its lock, leases and events somewhere else than its logs.
      ...(paths.rootDir === path.join(homeDir, ".toolkit", "tend")
        ? {}
        : { TOOLKIT_TEND_DIR: paths.rootDir }),
      ...(ghConfigDir === undefined ? {} : { GH_CONFIG_DIR: ghConfigDir }),
    },
  };
}

export type TendScheduleDeps = {
  readonly paths?: TendPaths | undefined;
  readonly homeDir?: string | undefined;
  /** The installing shell's environment; only `GH_CONFIG_DIR` is read. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly fileExists?: ((filePath: string) => Promise<boolean>) | undefined;
  /** The installed plist's text, or `null` when there is none. */
  readonly readPlist?:
    ((plistPath: string) => Promise<string | null>) | undefined;
  readonly assertSupported?: ((action: string) => void) | undefined;
  readonly install?: ((spec: LaunchAgentSpec) => Promise<void>) | undefined;
  readonly uninstall?: ((spec: LaunchAgentSpec) => Promise<void>) | undefined;
  readonly status?:
    | ((
        spec: LaunchAgentSpec,
      ) => Promise<{ installed: boolean; loaded: boolean }>)
    | undefined;
};

async function readFileIfPresent(filePath: string): Promise<string | null> {
  const file = Bun.file(filePath);
  return (await file.exists()) ? file.text() : null;
}

/** Shown where the job carries no `gh` configuration directory. */
const GH_DEFAULT_CONFIG_TEXT = "gh's default (no GH_CONFIG_DIR carried)";

/**
 * Whether the job is installed and loaded, and the `gh` configuration it
 * carries. That is read from the installed plist: a reinstall from this
 * shell could choose differently. `ghConfigDir` is what an install from this
 * shell would carry, shown when nothing is installed.
 */
async function printScheduleStatus(
  spec: LaunchAgentSpec,
  ghConfigDir: string | undefined,
  deps: TendScheduleDeps,
  json: boolean,
): Promise<void> {
  const state = await (deps.status ?? launchAgentJobStatus)(spec);
  const logs = launchAgentLogPaths(spec);
  const plist = state.installed
    ? await (deps.readPlist ?? readFileIfPresent)(spec.plistPath)
    : null;
  const jobGhConfigDir =
    plist === null
      ? ghConfigDir
      : parseLaunchAgentEnvironment(plist)["GH_CONFIG_DIR"];
  if (json) {
    console.log(
      JSON.stringify(
        {
          label: spec.label,
          plistPath: spec.plistPath,
          installed: state.installed,
          loaded: state.loaded,
          dailyAt: DAILY_AT_TEXT,
          programArguments: spec.programArguments,
          ghConfigDir: jobGhConfigDir ?? null,
          logs,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    [
      `Tend LaunchAgent ${spec.label}: ${state.installed ? "installed" : "not installed"} (${state.loaded ? "loaded" : "not loaded"})`,
      `Plist: ${spec.plistPath}`,
      `GitHub config${plist === null ? " (if installed from this shell)" : ""}: ${jobGhConfigDir ?? GH_DEFAULT_CONFIG_TEXT}`,
      `Logs: ${logs.stdout}`,
    ].join("\n"),
  );
}

const SCHEDULE_USAGE =
  "Usage: toolkit tend schedule install | uninstall | status [--json]";

export async function handleTendScheduleCommand(
  args: readonly string[],
  deps: TendScheduleDeps = {},
): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { json: { type: "boolean", default: false } },
  });
  const [action, ...extra] = positionals;
  if (action === undefined || extra.length > 0) {
    throw new Error(SCHEDULE_USAGE);
  }
  const homeDir = deps.homeDir ?? Bun.env["HOME"] ?? os.homedir();
  const ghConfigDir = await resolveScheduleGhConfigDir({
    homeDir,
    env: deps.env ?? Bun.env,
    fileExists: deps.fileExists ?? ((filePath) => Bun.file(filePath).exists()),
  });
  const spec = tendLaunchAgent(
    deps.paths ?? resolveTendPaths(),
    homeDir,
    ghConfigDir,
  );
  const assertSupported = deps.assertSupported ?? assertDarwin;
  const logs = launchAgentLogPaths(spec);

  switch (action) {
    case "install":
      assertSupported("toolkit tend schedule install");
      await (deps.install ?? installLaunchAgentJob)(spec);
      console.log(
        [
          `Tend LaunchAgent installed: ${spec.plistPath}`,
          `Runs daily at ${DAILY_AT_TEXT}: ${spec.programArguments.join(" ")}`,
          `Nothing runs now; the first sweep is the next ${DAILY_AT_TEXT}, or the next wake after it.`,
          "To sweep by hand: `toolkit tend worktrees` (dry run), then `toolkit tend worktrees --apply`; the same for `toolkit tend dedupe`.",
          `GitHub config: ${ghConfigDir ?? GH_DEFAULT_CONFIG_TEXT}`,
          `Logs: ${logs.stdout}`,
        ].join("\n"),
      );
      return;
    case "uninstall":
      assertSupported("toolkit tend schedule uninstall");
      await (deps.uninstall ?? uninstallLaunchAgentJob)(spec);
      console.log(`Tend LaunchAgent removed: ${spec.plistPath}`);
      return;
    case "status":
      await printScheduleStatus(spec, ghConfigDir, deps, values.json);
      return;
    default:
      throw new Error(
        `Unknown tend schedule action "${action}". ${SCHEDULE_USAGE}`,
      );
  }
}
