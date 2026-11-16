import { renderStatus } from "#lib/mc/render.ts";
import {
  assertProtocol,
  cleanDeadMcDaemonFiles,
  daemonLogPath,
  probeMcDaemonStatus,
  startMcDaemon,
  stopMcDaemon,
} from "#lib/mc/spawn.ts";

export async function mcDaemonStartCommand(ttlSeconds: number): Promise<void> {
  const status = await startMcDaemon(ttlSeconds);
  console.log(renderStatus(status));
  console.log(`\nLogs: ${daemonLogPath()}`);
}

export async function mcDaemonStopCommand(): Promise<void> {
  await stopMcDaemon();
  console.log("mc daemon stopped (non-kept sandboxes removed).");
}

export async function mcDaemonStatusCommand(json: boolean): Promise<void> {
  const status = await probeMcDaemonStatus();
  if (status === null) {
    await cleanDeadMcDaemonFiles();
    console.log("mc daemon is not running.");
    process.exitCode = 1;
    return;
  }
  assertProtocol(status);
  console.log(json ? JSON.stringify(status, null, 2) : renderStatus(status));
}
