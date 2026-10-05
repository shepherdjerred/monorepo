import { mkdir } from "node:fs/promises";
import {
  jsonlLogger,
  serveUnixDaemon,
} from "@shepherdjerred/unix-socket-daemon";
import { type DaemonState, DaemonStateSchema } from "#protocol/ipc.ts";
import {
  CLIENTS_DIR,
  LOGS_DIR,
  SOCKET_PATH,
  STATE_PATH,
} from "#protocol/paths.ts";
import { PROTOCOL_VERSION } from "#protocol/version.ts";
import { ClientManager, gradleLauncher } from "./clients.ts";
import { DaemonError } from "./http.ts";
import { type DaemonContext, routeRequest } from "./router.ts";
import { LIVE_TARGET_ID } from "#protocol/live.ts";
import type { SandboxBackend } from "#sandbox/provider.ts";
import type { LiveService } from "#src/live/service.ts";
import { sandboxTarget } from "#src/target.ts";

/** One JSONL line per event under ~/.toolkit/mc/logs. Never pass secrets. */
export const logLine = jsonlLogger(LOGS_DIR);

async function reapExpired(
  provider: SandboxBackend,
  clients: ClientManager,
  when: string,
): Promise<void> {
  const reaped = await provider.reap(new Date());
  if (reaped.length > 0) {
    logLine(`reaped sandboxes ${when}`, { reaped });
  }
  for (const id of reaped) {
    await clients.stopForTarget(id);
  }
}

export async function startDaemon(options: {
  provider: SandboxBackend;
  live: LiveService;
  ttlSeconds: number;
  repoRoot: string;
}): Promise<void> {
  const { provider, live, ttlSeconds, repoRoot } = options;
  await mkdir(LOGS_DIR, { recursive: true, mode: 0o700 });
  await provider.preflight();
  const clients = new ClientManager({
    repoRoot,
    dir: CLIENTS_DIR,
    launcher: gradleLauncher,
    log: logLine,
  });
  await reapExpired(provider, clients, "on start");

  const ctx: DaemonContext = {
    provider,
    live,
    target: async (id) => {
      if (id === LIVE_TARGET_ID) {
        return live.target();
      }
      const records = await provider.list();
      const record = records.find((candidate) => candidate.id === id);
      if (record === undefined) {
        throw new DaemonError(`No sandbox ${id}`, 404);
      }
      if (record.status !== "ready") {
        throw new DaemonError(`Sandbox ${id} is ${record.status}`, 409);
      }
      return sandboxTarget(record, provider);
    },
    clients,
    startedAt: new Date().toISOString(),
    ttlSeconds,
    repoRoot,
    lastActivity: Date.now(),
    log: logLine,
  };

  const state: DaemonState = DaemonStateSchema.parse({
    pid: process.pid,
    startedAt: ctx.startedAt,
    ttlSeconds,
    protocolVersion: PROTOCOL_VERSION,
  });

  await serveUnixDaemon({
    socketPath: SOCKET_PATH,
    statePath: STATE_PATH,
    state,
    ttlSeconds,
    lastActivity: () => ctx.lastActivity,
    handle: (url, request) => routeRequest(ctx, url, request),
    // Sandboxes expire on their own TTL even while the daemon stays busy.
    onTick: () => reapExpired(provider, clients, "past their TTL"),
    onShutdown: async () => {
      live.stop();
      await clients.stopAll();
      // Kept sandboxes outlive the daemon; everything else goes with it.
      for (const record of await provider.list()) {
        if (!record.keep) {
          await provider.destroy(record.id).catch((error: unknown) => {
            logLine("sandbox destroy failed", {
              id: record.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
    },
    log: logLine,
  });

  logLine("daemon listening", { socket: SOCKET_PATH, ttlSeconds, repoRoot });
}
