import { mkdir } from "node:fs/promises";
import {
  assertDarwin,
  bootoutLaunchAgent,
  installLaunchAgentJob,
  launchAgentJobStatus,
  renderLaunchAgentPlist,
  selfArgv,
  startLaunchAgentJob,
  uninstallLaunchAgentJob,
  type LaunchAgentSpec,
} from "#lib/launchd.ts";
import {
  defaultHistoryRuntimePaths,
  type HistoryRuntimePaths,
} from "#lib/history/paths.ts";

const LABEL = "com.jerred.toolkit-history";

function historyLaunchAgent(
  runtimePaths: HistoryRuntimePaths,
): LaunchAgentSpec {
  return {
    label: LABEL,
    plistPath: runtimePaths.launchAgent,
    programArguments: selfArgv(["history", "daemon", "serve"]),
    logsDir: runtimePaths.logsDir,
    keepAlive: true,
  };
}

export function renderLaunchAgent(runtimePaths: HistoryRuntimePaths): string {
  return renderLaunchAgentPlist(historyLaunchAgent(runtimePaths));
}

export async function installLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  assertDarwin("History ingestion");
  await mkdir(runtimePaths.historyDir, { recursive: true, mode: 0o700 });
  await installLaunchAgentJob(historyLaunchAgent(runtimePaths));
  console.log(`History LaunchAgent installed: ${runtimePaths.launchAgent}`);
}

export async function startLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  assertDarwin("History ingestion");
  if (!(await Bun.file(runtimePaths.launchAgent).exists())) {
    throw new Error(
      `LaunchAgent is not installed. Run 'toolkit history daemon install' first.`,
    );
  }
  await startLaunchAgentJob(historyLaunchAgent(runtimePaths));
  console.log("History daemon started.");
}

export async function stopLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  assertDarwin("History ingestion");
  const installed = await Bun.file(runtimePaths.launchAgent).exists();
  await bootoutLaunchAgent(LABEL);
  console.log(
    installed ? "History daemon stopped." : "History daemon was not installed.",
  );
}

export async function uninstallLaunchAgent(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<void> {
  assertDarwin("History ingestion");
  await uninstallLaunchAgentJob(historyLaunchAgent(runtimePaths));
  console.log("History daemon stopped.");
  console.log(`History LaunchAgent removed: ${runtimePaths.launchAgent}`);
}

export async function launchAgentStatus(
  runtimePaths = defaultHistoryRuntimePaths(),
): Promise<{ installed: boolean; loaded: boolean }> {
  return launchAgentJobStatus(historyLaunchAgent(runtimePaths));
}

export const HISTORY_LAUNCH_AGENT_LABEL = LABEL;
