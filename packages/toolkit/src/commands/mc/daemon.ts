import { StatusResponseSchema } from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { SOCKET_PATH } from "@shepherdjerred/mc-harness/protocol/paths.ts";
import { pathExists, pidAlive } from "@shepherdjerred/unix-socket-daemon";
import { daemonRequest } from "#lib/mc/client.ts";
import { renderStatus } from "#lib/mc/render.ts";
import {
  assertProtocol,
  daemonLogPath,
  readDaemonState,
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
  if (!(await pathExists(SOCKET_PATH))) {
    const state = await readDaemonState();
    console.log(
      state !== null && !pidAlive(state.pid)
        ? "mc daemon is not running (stale state — run 'toolkit mc daemon stop' to clean up)."
        : "mc daemon is not running.",
    );
    process.exitCode = 1;
    return;
  }
  const status = await daemonRequest(StatusResponseSchema, "GET", "/status");
  assertProtocol(status);
  console.log(json ? JSON.stringify(status, null, 2) : renderStatus(status));
}
