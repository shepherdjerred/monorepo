/**
 * Scaffolding shared by the repo's local unix-socket HTTP daemons (toolkit
 * discord, mc-harness): the socket server with a `/shutdown` route, the idle
 * TTL, the 0600 state file, signal handling, and the PID identity check that
 * keeps `stop` from signalling a recycled PID.
 */
import {
  appendFile,
  chmod,
  mkdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type LogLine = (msg: string, extra?: Record<string, unknown>) => void;

/** One JSONL line per event in `<logsDir>/daemon-YYYY-MM-DD.log`. Never pass secrets. */
export function jsonlLogger(logsDir: string): LogLine {
  return (msg, extra = {}) => {
    const now = new Date().toISOString();
    const line = `${JSON.stringify({ ts: now, msg, ...extra })}\n`;
    void appendFile(path.join(logsDir, `daemon-${now.slice(0, 10)}.log`), line);
  };
}

/** Parses `90m`, `4h`, `30s` or bare seconds into seconds. */
export function parseTtl(raw: string): number {
  const match = /^(\d+)([hms]?)$/u.exec(raw.trim());
  if (match === null) {
    throw new Error(
      `Invalid TTL "${raw}" — use a number with optional s/m/h suffix, e.g. 90m or 4h`,
    );
  }
  const value = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2] ?? "";
  const multiplier = unit === "h" ? 3600 : unit === "m" ? 60 : 1;
  return value * multiplier;
}

/** `Bun.file().exists()` is false for sockets, so check with stat. */
export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The process's full command line, or null when no such process exists. */
export async function processCommand(pid: number): Promise<string | null> {
  const ps = Bun.spawn(["ps", "-o", "command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const [out, code] = await Promise.all([
    new Response(ps.stdout).text(),
    ps.exited,
  ]);
  const command = out.trim();
  return code === 0 && command.length > 0 ? command : null;
}

/**
 * True only when `pid` is provably the daemon: either its own `/status`
 * reported this PID, or the live process command line contains `marker`
 * (the daemon's entry point). A PID from a stale state file may have been
 * recycled by an unrelated process, which must never be signalled.
 */
export async function isDaemonPid(
  pid: number,
  options: { statusPid?: number | undefined; marker: string },
): Promise<boolean> {
  if (options.statusPid !== undefined) {
    return options.statusPid === pid;
  }
  const command = await processCommand(pid);
  return command?.includes(options.marker) === true;
}

/** A state-file PID that is alive and provably still the daemon. */
export async function daemonRunning(
  pid: number,
  marker: string,
): Promise<boolean> {
  return pidAlive(pid) && (await isDaemonPid(pid, { marker }));
}

export type StopOutcome = "not-running" | "stale" | "exited" | "terminated";

/**
 * After a `/shutdown` request, waits for the daemon PID to exit and sends
 * SIGTERM only when the PID is still provably the daemon. A stale state file
 * whose PID now belongs to another process reports `stale` and signals nothing.
 */
export async function stopDaemonPid(
  pid: number | null,
  options: { statusPid?: number | undefined; marker: string; waitMs: number },
): Promise<StopOutcome> {
  if (pid === null || !pidAlive(pid)) {
    return "not-running";
  }
  if (
    !(await isDaemonPid(pid, {
      statusPid: options.statusPid,
      marker: options.marker,
    }))
  ) {
    return "stale";
  }
  const deadline = Date.now() + options.waitMs;
  while (Date.now() < deadline && pidAlive(pid)) {
    await Bun.sleep(200);
  }
  // Re-prove identity right before signalling: the PID may have been reused.
  if (!pidAlive(pid) || !(await isDaemonPid(pid, { marker: options.marker }))) {
    return "exited";
  }
  process.kill(pid, "SIGTERM");
  return "terminated";
}

export type UnixDaemonOptions = {
  socketPath: string;
  statePath: string;
  /** Written to `statePath` (mode 0600) once the socket is listening. */
  state: unknown;
  ttlSeconds: number;
  /** Epoch ms of the last client request; the daemon exits once idle past the TTL. */
  lastActivity: () => number;
  handle: (url: URL, request: Request) => Promise<Response> | Response;
  /** Daemon-specific teardown, run before the socket closes. */
  onShutdown: () => Promise<void>;
  /** Periodic work (e.g. reaping), never run concurrently with itself. */
  onTick?: () => Promise<void>;
  log: LogLine;
  tickMs?: number;
  /** Overridable for tests. */
  exit?: (code: number) => void;
  handleSignals?: boolean;
};

export type UnixDaemon = {
  shutdown: (reason: string) => Promise<void>;
};

export async function serveUnixDaemon(
  options: UnixDaemonOptions,
): Promise<UnixDaemon> {
  const { socketPath, statePath, ttlSeconds, log } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  await rm(socketPath, { force: true });

  let shuttingDown = false;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let tickInFlight = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log("shutting down", { reason });
    if (tickTimer !== null) {
      clearInterval(tickTimer);
    }
    await options.onShutdown().catch((error: unknown) => {
      log("shutdown hook failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    await server.stop(true);
    await rm(socketPath, { force: true });
    await rm(statePath, { force: true });
    exit(0);
  };

  const server = Bun.serve({
    unix: socketPath,
    fetch(request): Promise<Response> | Response {
      const url = new URL(request.url);
      if (url.pathname === "/shutdown") {
        setTimeout(() => {
          void shutdown("shutdown requested");
        }, 50);
        return Response.json({ ok: true });
      }
      return options.handle(url, request);
    },
  });
  await chmod(socketPath, 0o600);

  tickTimer = setInterval(() => {
    if (Date.now() - options.lastActivity() > ttlSeconds * 1000) {
      void shutdown(`idle TTL of ${String(ttlSeconds)}s reached`);
      return;
    }
    const onTick = options.onTick;
    if (onTick === undefined || tickInFlight) {
      return;
    }
    tickInFlight = true;
    void (async () => {
      try {
        await onTick();
      } catch (error) {
        log("tick failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        tickInFlight = false;
      }
    })();
  }, options.tickMs ?? 30_000);

  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(options.state, null, 2), {
    mode: 0o600,
  });

  if (options.handleSignals ?? true) {
    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
  }
  return { shutdown };
}
