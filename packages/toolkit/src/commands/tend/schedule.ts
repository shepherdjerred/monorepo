import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  HOMEBREW_JOB_PATH,
  assertDarwin,
  installLaunchAgentJob,
  launchAgentJobStatus,
  launchAgentLogPaths,
  selfArgv,
  uninstallLaunchAgentJob,
  type LaunchAgentSpec,
} from "#lib/launchd.ts";
import { resolveTendPaths, type TendPaths } from "#lib/tend/paths.ts";

export const TEND_LAUNCH_AGENT_LABEL = "com.jerred.toolkit-tend";
const INTERVAL_SECONDS = 24 * 60 * 60;

/** What the daily job runs: `toolkit tend run --apply --only worktrees`. */
const TEND_SCHEDULE_ARGS = [
  "tend",
  "run",
  "--apply",
  "--only",
  "worktrees",
] as const;

/**
 * The reaper is a per-user LaunchAgent, not a Temporal Schedule: it acts on
 * one workstation's local checkouts and reads that login session's Herdr
 * terminals, processes and `gh` credentials.
 */
export function tendLaunchAgent(
  paths: TendPaths,
  homeDir: string,
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
    startIntervalSeconds: INTERVAL_SECONDS,
    // launchd's own PATH has neither `gh` (Homebrew) nor `hc` (~/.local/bin),
    // and a sweep that cannot see Herdr sessions holds itself.
    environment: {
      PATH: `${path.join(homeDir, ".local", "bin")}:${HOMEBREW_JOB_PATH}`,
    },
  };
}

export type TendScheduleDeps = {
  readonly paths?: TendPaths | undefined;
  readonly homeDir?: string | undefined;
  readonly assertSupported?: ((action: string) => void) | undefined;
  readonly install?: ((spec: LaunchAgentSpec) => Promise<void>) | undefined;
  readonly uninstall?: ((spec: LaunchAgentSpec) => Promise<void>) | undefined;
  readonly status?:
    | ((
        spec: LaunchAgentSpec,
      ) => Promise<{ installed: boolean; loaded: boolean }>)
    | undefined;
};

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
  const spec = tendLaunchAgent(deps.paths ?? resolveTendPaths(), homeDir);
  const assertSupported = deps.assertSupported ?? assertDarwin;
  const logs = launchAgentLogPaths(spec);

  switch (action) {
    case "install":
      assertSupported("toolkit tend schedule install");
      await (deps.install ?? installLaunchAgentJob)(spec);
      console.log(
        [
          `Tend LaunchAgent installed: ${spec.plistPath}`,
          `Runs every 24 hours, and once now: ${spec.programArguments.join(" ")}`,
          `Logs: ${logs.stdout}`,
        ].join("\n"),
      );
      return;
    case "uninstall":
      assertSupported("toolkit tend schedule uninstall");
      await (deps.uninstall ?? uninstallLaunchAgentJob)(spec);
      console.log(`Tend LaunchAgent removed: ${spec.plistPath}`);
      return;
    case "status": {
      const state = await (deps.status ?? launchAgentJobStatus)(spec);
      if (values.json) {
        console.log(
          JSON.stringify(
            {
              label: spec.label,
              plistPath: spec.plistPath,
              installed: state.installed,
              loaded: state.loaded,
              intervalSeconds: INTERVAL_SECONDS,
              programArguments: spec.programArguments,
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
          `Logs: ${logs.stdout}`,
        ].join("\n"),
      );
      return;
    }
    default:
      throw new Error(
        `Unknown tend schedule action "${action}". ${SCHEDULE_USAGE}`,
      );
  }
}
