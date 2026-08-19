import { appendFile, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHistorySources } from "./sources.ts";
import { HistoryIndex } from "./index.ts";
import { defaultHistoryPaths, defaultHistoryRuntimePaths } from "./paths.ts";
import {
  HistoryDaemonStatusSchema,
  HistoryDaemonResponseSchema,
} from "./ipc.ts";
import type { HistoryPaths, HistoryRuntimePaths } from "./paths.ts";
import type { HistoryDaemonState } from "./ipc.ts";
import type { HistorySource, HistorySourceResult } from "./types.ts";

const INTERVAL_SECONDS = 30;
const SOURCE_SCAN_CONCURRENCY = 2;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function logLine(
  runtimePaths: HistoryRuntimePaths,
  message: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const logPath = path.join(runtimePaths.logsDir, `daemon-${day}.log`);
  const line = `${JSON.stringify({ ts: new Date().toISOString(), message, ...extra })}\n`;
  await appendFile(logPath, line, {
    mode: 0o600,
  });
  await chmod(logPath, 0o600);
}

export async function scanHistorySources(
  sources: readonly HistorySource[],
  paths: HistoryPaths,
): Promise<HistorySourceResult[]> {
  const results: HistorySourceResult[] = [];
  for (
    let offset = 0;
    offset < sources.length;
    offset += SOURCE_SCAN_CONCURRENCY
  ) {
    results.push(
      ...(await Promise.all(
        sources
          .slice(offset, offset + SOURCE_SCAN_CONCURRENCY)
          .map(async (source) => source.scan(paths)),
      )),
    );
  }
  return results;
}

export async function runHistoryDaemon(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "The history LaunchAgent daemon is supported only on macOS.",
    );
  }
  const paths = defaultHistoryPaths();
  const runtimePaths = defaultHistoryRuntimePaths();
  await mkdir(runtimePaths.historyDir, { recursive: true, mode: 0o700 });
  await mkdir(runtimePaths.logsDir, { recursive: true, mode: 0o700 });
  await chmod(runtimePaths.historyDir, 0o700);
  await chmod(runtimePaths.logsDir, 0o700);
  await rm(runtimePaths.socket, { force: true });

  const index = await HistoryIndex.open(runtimePaths);
  const sources = createHistorySources();
  const labels = new Map(sources.map((source) => [source.name, source.label]));
  let lastScanAt: string | null = null;
  let scanning = false;
  let shuttingDown = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let server: {
    stop: (closeActiveConnections?: boolean) => Promise<void>;
  } | null = null;

  const scan = async (force: boolean): Promise<void> => {
    if (scanning) {
      return;
    }
    scanning = true;
    try {
      const results = await scanHistorySources(sources, paths);
      await index.ingest(results, force);
      lastScanAt = new Date().toISOString();
      await logLine(runtimePaths, "history scan complete", {
        force,
        sources: results.map((result) => ({
          source: result.source,
          available: result.available,
          documents: result.documents.length,
          error: result.error,
        })),
      });
    } catch (error: unknown) {
      await logLine(runtimePaths, "history scan failed", {
        error: getErrorMessage(error),
      });
      throw error;
    } finally {
      scanning = false;
    }
  };

  await scan(false);

  const state = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    intervalSeconds: INTERVAL_SECONDS,
    lastScanAt,
  } satisfies HistoryDaemonState;
  await writeFile(runtimePaths.state, JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  await chmod(runtimePaths.state, 0o600);

  const reindex = async (): Promise<void> => {
    try {
      await scan(true);
    } catch (error: unknown) {
      await logLine(runtimePaths, "history reindex failed", {
        error: getErrorMessage(error),
      });
    }
  };

  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (timer !== null) {
      clearInterval(timer);
    }
    await logLine(runtimePaths, "history daemon stopping", { reason });
    await server?.stop(true);
    index.close();
    await rm(runtimePaths.socket, { force: true });
    await rm(runtimePaths.state, { force: true });
    process.exit(0);
  };

  server = Bun.serve({
    unix: runtimePaths.socket,
    fetch: (request): Response => {
      const url = new URL(request.url);
      if (url.pathname === "/status") {
        const status = {
          ...state,
          lastScanAt,
          sources: index.statuses(labels),
        };
        return Response.json(HistoryDaemonStatusSchema.parse(status));
      }
      if (url.pathname === "/reindex") {
        void reindex();
        return Response.json(HistoryDaemonResponseSchema.parse({ ok: true }));
      }
      if (url.pathname === "/shutdown") {
        setTimeout(() => {
          void shutdown("shutdown requested");
        }, 25);
        return Response.json({ ok: true });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  await chmod(runtimePaths.socket, 0o600);
  const poll = async (): Promise<void> => {
    try {
      await scan(false);
    } catch (error: unknown) {
      await logLine(runtimePaths, "history poll failed", {
        error: getErrorMessage(error),
      });
    }
  };
  timer = setInterval(() => {
    void poll();
  }, INTERVAL_SECONDS * 1000);

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  await logLine(runtimePaths, "history daemon listening", {
    socket: runtimePaths.socket,
    intervalSeconds: INTERVAL_SECONDS,
  });
}
