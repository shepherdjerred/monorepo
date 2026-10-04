import { appendFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { type DaemonState, DaemonStateSchema } from "#protocol/ipc.ts";
import { LOGS_DIR, MC_DIR, SOCKET_PATH, STATE_PATH } from "#protocol/paths.ts";
import { PROTOCOL_VERSION } from "#protocol/version.ts";
import { DaemonError, type DaemonContext, routeRequest } from "./router.ts";
import type { SandboxProvider } from "#sandbox/provider.ts";
import { sandboxTarget } from "#src/target.ts";

/** One JSONL line per event under ~/.toolkit/mc/logs. Never pass secrets. */
export function logLine(
  msg: string,
  extra: Record<string, unknown> = {},
): void {
  const now = new Date().toISOString();
  const line = `${JSON.stringify({ ts: now, msg, ...extra })}\n`;
  void appendFile(path.join(LOGS_DIR, `daemon-${now.slice(0, 10)}.log`), line);
}

export async function startDaemon(options: {
  provider: SandboxProvider;
  ttlSeconds: number;
  repoRoot: string;
}): Promise<void> {
  const { provider, ttlSeconds, repoRoot } = options;
  await mkdir(LOGS_DIR, { recursive: true, mode: 0o700 });
  await provider.preflight();
  const reaped = await provider.reap(new Date());
  if (reaped.length > 0) {
    logLine("reaped sandboxes on start", { reaped });
  }

  const ctx: DaemonContext = {
    provider,
    target: async (id) => {
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
    startedAt: new Date().toISOString(),
    ttlSeconds,
    repoRoot,
    lastActivity: Date.now(),
    log: logLine,
  };

  await rm(SOCKET_PATH, { force: true });

  let shuttingDown = false;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logLine("shutting down", { reason });
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
    await server.stop(true);
    if (idleTimer !== null) {
      clearInterval(idleTimer);
    }
    await rm(SOCKET_PATH, { force: true });
    await rm(STATE_PATH, { force: true });
    process.exit(0);
  };

  const server = Bun.serve({
    unix: SOCKET_PATH,
    fetch(request): Promise<Response> | Response {
      const url = new URL(request.url);
      if (url.pathname === "/shutdown") {
        setTimeout(() => {
          void shutdown("shutdown requested");
        }, 50);
        return Response.json({ ok: true });
      }
      return routeRequest(ctx, url, request);
    },
  });
  await chmod(SOCKET_PATH, 0o600);

  idleTimer = setInterval(() => {
    if (Date.now() - ctx.lastActivity > ttlSeconds * 1000) {
      void shutdown(`idle TTL of ${String(ttlSeconds)}s reached`);
    }
  }, 30_000);

  const state: DaemonState = DaemonStateSchema.parse({
    pid: process.pid,
    startedAt: ctx.startedAt,
    ttlSeconds,
    protocolVersion: PROTOCOL_VERSION,
  });
  await mkdir(MC_DIR, { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  logLine("daemon listening", { socket: SOCKET_PATH, ttlSeconds, repoRoot });
}
