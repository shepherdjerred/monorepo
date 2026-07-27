/**
 * Boot a registered package's dev server for `toolkit screenshot`.
 */
import { repoRoot } from "#lib/deployed/git.ts";
import type { PackageEntry } from "./types.ts";

export type DevServerHandle = {
  baseUrl: string;
  stop: () => Promise<void>;
};

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
 * Occupancy probe: is *anything* bound to this port? A TCP connect (not an HTTP
 * fetch) so it detects every listener — a non-HTTP service or an HTTPS-only
 * server would make `fetch()` reject and be misreported as free, letting a
 * fresh Astro/Vite spawn auto-increment while we probe the wrong port until the
 * timeout. Checks both loopback families so an IPv6-only listener still counts.
 */
async function isPortInUse(port: number): Promise<boolean> {
  return (
    (await canConnect("127.0.0.1", port)) || (await canConnect("::1", port))
  );
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
  const baseUrl = `http://localhost:${String(entry.expectedPort)}`;

  // Always spawn a fresh, isolated dev server on the package's fixed
  // `expectedPort` — never reuse whatever is already listening there. A status
  // probe can't prove the running server is actually the requested app: an
  // unrelated process, a stale build, or (for auth-gated entries) a stack
  // started without ENABLE_DEV_LOGIN could be on that port. Dev commands also
  // print inconsistent/hard-coded banners, so the bound port can't be read
  // back from stdout either. So: require the port to be free and let the child
  // bind exactly it; if it's occupied, fail fast rather than capture the wrong
  // server or auto-bump to an unknown port.
  if (await isPortInUse(entry.expectedPort)) {
    throw new Error(
      `${entry.alias}: port ${String(entry.expectedPort)} is already in use. ` +
        `toolkit screenshot always spawns its own server on this fixed port (it can't verify an already-running one is the right app), ` +
        `so stop whatever is on :${String(entry.expectedPort)} and retry.`,
    );
  }

  const root = await repoRoot();
  if (root === null) {
    throw new Error(
      "Not inside the monorepo (git rev-parse --show-toplevel failed or versions.ts is missing) — toolkit screenshot must run from within the repo checkout.",
    );
  }
  // `detached` puts the child in its own process group so `stop()` can signal
  // the whole tree (dev commands spawn descendants — see stop()).
  // `BROWSER=none` stops a dev command that auto-opens a browser (docs-board's
  // dev.ts runs `vite --open`) from popping the user's default browser — Vite
  // honors this env var — since we drive an isolated PinchTab tab instead.
  const proc = Bun.spawn(entry.devCommand, {
    cwd: `${root}/${entry.cwd}`,
    env: { ...Bun.env, ...options.envOverrides, BROWSER: "none" },
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

  // Drain stdout/stderr purely for diagnostics — the bound port is known
  // (expectedPort), so nothing is parsed out of it. Draining keeps the pipes
  // from filling and stalling the child.
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

  const stop = async () => {
    // The dev command may spawn descendants (docs-board's dev.ts starts
    // separate API + Vite children; scout's dev-web.sh starts backend + Vite).
    // The child is a group leader (spawned `detached`), so signal the whole
    // group with a negative PID — killing only `bun run` would orphan those
    // servers and leave their ports occupied for the next run.
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      // No such group (already exited, or a platform without process groups)
      // — fall back to signaling the child directly.
      proc.kill();
    }
    // Clear the loser of the race: if the process exits promptly, an
    // un-cleared 5s timer would keep Bun's event loop (and thus the CLI)
    // alive for the full 5s after cleanup.
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
  };

  // Register teardown NOW — before the readiness wait — so a signal delivered
  // during startup still tears the child (and its group) down.
  options.registerCleanup?.(stop);

  // Wait until the freshly-spawned server answers on the expected port, the
  // process exits (fail fast — e.g. missing tool, `op` not signed in), or we
  // hit the deadline.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeReady(`${baseUrl}${readyPath}`, 2000)) {
      void stdoutDone;
      void stderrDone;
      return { baseUrl, stop };
    }
    // `exitCode` is null until the child exits — a non-null value means it
    // died before becoming ready (missing tool, `op` not signed in, …), so
    // surface the captured output immediately instead of waiting the deadline.
    if (proc.exitCode !== null) {
      await stop();
      throw new Error(
        `${entry.alias}: dev server exited before it became ready.\n--- output ---\n${combinedOutput}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await stop();
  throw new Error(
    `${entry.alias}: dev server did not become ready on :${String(entry.expectedPort)}${readyPath} within ${String(timeoutMs)}ms.\n--- output ---\n${combinedOutput}`,
  );
}
