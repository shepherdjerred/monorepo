/**
 * Boot a registered package's dev server on an isolated free port for
 * `toolkit screenshot` and `toolkit screenshot-server`.
 */
import net from "node:net";
import { repoRoot } from "#lib/deployed/git.ts";
import type { PackageEntry } from "./types.ts";

export type DevServerHandle = {
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
};

const HUB_DEFAULT_API_PORT = 7341;
const SCOUT_DEFAULT_BACKEND_PORT = 3000;
const SCOUT_TEMPORAL_PORT_OFFSET = 4233;
const SCOUT_TEMPORAL_UI_PORT_OFFSET = 5233;

/** Readiness probe: a non-5xx response on `url` means the app is up. */
async function probeReady(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Bun.connect requires socket lifecycle handlers; this probe only cares
// whether the connection opens at all, so every handler is a no-op.
const noopSocketHandler = (): void => undefined;
const DEV_SERVER_BLOCKED_ENV = new Set([
  "PINCHTAB_CONFIG",
  "PINCHTAB_SESSION",
  "PINCHTAB_TOKEN",
]);

function devServerEnvironment(): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined && !DEV_SERVER_BLOCKED_ENV.has(key)) {
      environment[key] = value;
    }
  }
  // Never let Astro 7 detach a silent background daemon in coding-agent runs.
  environment["ASTRO_DEV_BACKGROUND"] = "0";
  environment["ASTRO_PREVIEW_BACKGROUND"] = "0";
  return environment;
}

/** Can we open a TCP connection to `hostname:port`? True means something is
 * listening there. */
async function canConnect(hostname: string, port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname,
      port,
      socket: {
        data: noopSocketHandler,
        open: noopSocketHandler,
        close: noopSocketHandler,
        error: noopSocketHandler,
      },
    });
    socket.end();
    return true;
  } catch {
    // Connection refused (or the address is unavailable) — nothing listening.
    return false;
  }
}

/**
 * Occupancy probe: is *anything* bound to this port? Checks both loopback
 * families via TCP connect so an IPv6-only listener (`localhost` -> `::1`) is
 * detected even when `127.0.0.1` appears unbound.
 */
async function isPortInUse(port: number): Promise<boolean> {
  return (
    (await canConnect("127.0.0.1", port)) || (await canConnect("::1", port))
  );
}

/**
 * Ephemerally bind `host:port` (or `127.0.0.1:0` when `port === 0`) and return
 * the bound port, or `null` if `EADDRINUSE` / unavailable.
 */
function tryBindPort(host: string, port: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      resolve(null);
    });
    server.listen({ host, port, exclusive: true }, () => {
      const address = server.address();
      const boundPort =
        address !== null && typeof address === "object" ? address.port : null;
      server.close(() => {
        resolve(boundPort);
      });
    });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  if (await isPortInUse(port)) {
    return false;
  }
  const boundLoopback = await tryBindPort("127.0.0.1", port);
  if (boundLoopback === null) {
    return false;
  }
  const boundWildcard = await tryBindPort("0.0.0.0", port);
  return boundWildcard !== null;
}

/**
 * Allocate an unused local TCP port. Prefers `preferredPort` when provided and
 * free across IPv4/IPv6 loopback and wildcard interfaces; otherwise binds
 * `127.0.0.1:0` to pick an ephemeral unused port not in `excludedPorts`.
 */
export async function allocateFreePort(
  preferredPort?: number,
  excludedPorts: ReadonlySet<number> = new Set(),
): Promise<number> {
  if (
    preferredPort !== undefined &&
    preferredPort >= 1 &&
    preferredPort <= 65_535 &&
    !excludedPorts.has(preferredPort) &&
    (await isPortAvailable(preferredPort))
  ) {
    return preferredPort;
  }

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = await tryBindPort("127.0.0.1", 0);
    if (
      candidate !== null &&
      !excludedPorts.has(candidate) &&
      !(await canConnect("::1", candidate)) &&
      (await tryBindPort("0.0.0.0", candidate)) !== null
    ) {
      return candidate;
    }
  }

  throw new Error("Failed to allocate an unused local TCP port after 32 tries");
}

function parseExplicitPortOverride(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const port = Number(value);
  return port >= 1 && port <= 65_535 ? port : undefined;
}

async function resolveLaunchPort(
  envVar: string,
  explicitRaw: string | undefined,
  preferredPort: number | undefined,
  used: Set<number>,
): Promise<number> {
  if (explicitRaw !== undefined) {
    const explicit = parseExplicitPortOverride(explicitRaw);
    if (explicit === undefined) {
      throw new Error(
        `Invalid explicit ${envVar} override "${explicitRaw}": expected an integer TCP port in 1..65535.`,
      );
    }
    if (used.has(explicit)) {
      throw new Error(
        `Explicit ${envVar} port ${String(explicit)} collides with another port in this launch.`,
      );
    }
    if (!(await isPortAvailable(explicit))) {
      throw new Error(
        `Explicit ${envVar} port ${String(explicit)} is already in use; toolkit screenshot refuses to capture an occupied port.`,
      );
    }
    used.add(explicit);
    return explicit;
  }
  const allocated = await allocateFreePort(preferredPort, used);
  used.add(allocated);
  return allocated;
}

async function buildHubDevFixtureLaunch(
  entry: PackageEntry,
  envOverrides: Record<string, string>,
): Promise<{ port: number; command: string[]; env: Record<string, string> }> {
  const used = new Set<number>();
  const webPort = await resolveLaunchPort(
    "PORT",
    envOverrides["PORT"],
    entry.expectedPort,
    used,
  );
  const apiPort = await resolveLaunchPort(
    "API_PORT",
    envOverrides["API_PORT"],
    HUB_DEFAULT_API_PORT,
    used,
  );

  return {
    port: webPort,
    command: [...entry.devCommand],
    env: {
      ...envOverrides,
      PORT: String(webPort),
      API_PORT: String(apiPort),
    },
  };
}

async function buildScoutDevWebLaunch(
  entry: PackageEntry,
  envOverrides: Record<string, string>,
): Promise<{ port: number; command: string[]; env: Record<string, string> }> {
  // `scout-dev-web` (`bun scripts/dev/dev-web.ts`) starts Vite, the Scout API
  // backend, and Temporal dev + UI listeners. Allocate 4 distinct free ports so
  // concurrent worktrees never collide on any of the 4 sockets.
  const used = new Set<number>();
  const webPort = await resolveLaunchPort(
    "SCOUT_DEV_WEB_PORT",
    envOverrides["SCOUT_DEV_WEB_PORT"],
    entry.expectedPort,
    used,
  );
  const backendPort = await resolveLaunchPort(
    "SCOUT_DEV_BACKEND_PORT",
    envOverrides["SCOUT_DEV_BACKEND_PORT"],
    SCOUT_DEFAULT_BACKEND_PORT,
    used,
  );

  const preferredTemporal =
    backendPort + SCOUT_TEMPORAL_PORT_OFFSET <= 65_535
      ? backendPort + SCOUT_TEMPORAL_PORT_OFFSET
      : SCOUT_DEFAULT_BACKEND_PORT + SCOUT_TEMPORAL_PORT_OFFSET;
  const temporalPort = await resolveLaunchPort(
    "SCOUT_DEV_TEMPORAL_PORT",
    envOverrides["SCOUT_DEV_TEMPORAL_PORT"],
    preferredTemporal,
    used,
  );

  const preferredTemporalUi =
    backendPort + SCOUT_TEMPORAL_UI_PORT_OFFSET <= 65_535
      ? backendPort + SCOUT_TEMPORAL_UI_PORT_OFFSET
      : SCOUT_DEFAULT_BACKEND_PORT + SCOUT_TEMPORAL_UI_PORT_OFFSET;
  const temporalUiPort = await resolveLaunchPort(
    "SCOUT_DEV_TEMPORAL_UI_PORT",
    envOverrides["SCOUT_DEV_TEMPORAL_UI_PORT"],
    preferredTemporalUi,
    used,
  );

  return {
    port: webPort,
    command: [...entry.devCommand],
    env: {
      ...envOverrides,
      SCOUT_DEV_WEB_PORT: String(webPort),
      SCOUT_DEV_BACKEND_PORT: String(backendPort),
      SCOUT_DEV_TEMPORAL_PORT: String(temporalPort),
      SCOUT_DEV_TEMPORAL_UI_PORT: String(temporalUiPort),
    },
  };
}

export async function buildIsolatedDevLaunch(
  entry: PackageEntry,
  envOverrides: Record<string, string> = {},
): Promise<{ port: number; command: string[]; env: Record<string, string> }> {
  switch (entry.devRunner) {
    case "astro": {
      const port = await allocateFreePort(entry.expectedPort);
      return {
        port,
        command: [
          ...entry.devCommand,
          "--",
          "--ignore-lock",
          "--port",
          String(port),
        ],
        env: { ...envOverrides },
      };
    }
    case "vite": {
      const port = await allocateFreePort(entry.expectedPort);
      return {
        port,
        command: [
          ...entry.devCommand,
          "--",
          "--port",
          String(port),
          "--strictPort",
        ],
        env: { ...envOverrides },
      };
    }
    case "port-env": {
      const port = await resolveLaunchPort(
        "PORT",
        envOverrides["PORT"],
        entry.expectedPort,
        new Set(),
      );
      return {
        port,
        command: [...entry.devCommand],
        env: {
          ...envOverrides,
          PORT: String(port),
        },
      };
    }
    case "hub-dev-fixture":
      return buildHubDevFixtureLaunch(entry, envOverrides);
    case "scout-dev-web":
      return buildScoutDevWebLaunch(entry, envOverrides);
  }
}

async function terminateProcessGroup(
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
): Promise<void> {
  if (process.platform === "win32") {
    try {
      const killer = Bun.spawn(
        ["taskkill", "/T", "/F", "/PID", String(proc.pid)],
        {
          stdout: "ignore",
          stderr: "ignore",
        },
      );
      await killer.exited;
    } catch {
      proc.kill();
    }
  } else {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill();
    }
  }

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    proc.exited,
    new Promise((resolve) => {
      killTimer = setTimeout(resolve, 5000);
    }),
  ]);
  if (killTimer !== undefined) {
    clearTimeout(killTimer);
  }

  if (proc.exitCode === null && process.platform !== "win32") {
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }
}

async function assertChildAlive(
  entry: PackageEntry,
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
  stop: () => Promise<void>,
  output: () => string,
): Promise<void> {
  if (proc.exitCode !== null) {
    await stop();
    throw new Error(
      `${entry.alias}: dev server exited before it became ready.\n--- output ---\n${output()}`,
    );
  }
}

export async function ensureDevServer(
  entry: PackageEntry,
  options: {
    envOverrides?: Record<string, string> | undefined;
    timeoutMs?: number | undefined;
    /**
     * Register the spawned server's teardown with the orchestrator the moment
     * it exists — before we start waiting for readiness — so a SIGINT during
     * the startup interval still stops the child. See screenshotCommand.
     */
    registerCleanup?: ((cleanup: () => Promise<void>) => void) | undefined;
  } = {},
): Promise<DevServerHandle> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const readyPath = entry.readyPath ?? entry.defaultRoute;

  const root = await repoRoot();
  if (root === null) {
    throw new Error(
      "Not inside the monorepo (git rev-parse --show-toplevel failed or the version catalog is missing) — toolkit screenshot must run from within the repo checkout.",
    );
  }

  const launch = await buildIsolatedDevLaunch(entry, options.envOverrides);
  const baseUrl = `http://localhost:${String(launch.port)}`;

  // `detached` puts the child in its own process group so `stop()` can signal
  // the whole tree (dev commands spawn descendants).
  // `BROWSER=none` stops a dev command that auto-opens a browser from popping
  // the user's default browser — Vite honors this env var — since we drive an
  // isolated PinchTab tab instead.
  const proc = Bun.spawn(launch.command, {
    cwd: `${root}/${entry.cwd}`,
    env: {
      ...devServerEnvironment(),
      ...launch.env,
      BROWSER: "none",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

  // Drain stdout/stderr purely for diagnostics so pipes cannot fill and stall.
  let combinedOutput = "";
  const readStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      combinedOutput += decoder.decode(value);
    }
  };
  const stdoutDone = readStream(proc.stdout);
  const stderrDone = readStream(proc.stderr);

  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopPromise ??= terminateProcessGroup(proc);
    return stopPromise;
  };

  // Register teardown NOW — before the readiness wait — so a signal delivered
  // during startup still tears the child (and its group) down.
  options.registerCleanup?.(stop);

  const deadline = Date.now() + timeoutMs;
  const readCombinedOutput = () => combinedOutput;
  while (Date.now() < deadline) {
    await assertChildAlive(entry, proc, stop, readCombinedOutput);
    if (await probeReady(`${baseUrl}${readyPath}`, 2000)) {
      await assertChildAlive(entry, proc, stop, readCombinedOutput);
      void stdoutDone;
      void stderrDone;
      return { baseUrl, port: launch.port, stop };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await stop();
  throw new Error(
    `${entry.alias}: dev server did not become ready on :${String(launch.port)}${readyPath} within ${String(timeoutMs)}ms.\n--- output ---\n${combinedOutput}`,
  );
}
