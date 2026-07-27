/**
 * Boot (or reuse) a registered package's dev server for `toolkit screenshot`.
 */
import { repoRoot } from "#lib/deployed/git.ts";
import { PACKAGES } from "./catalog.ts";
import type { PackageEntry } from "./types.ts";

export type DevServerHandle = {
  baseUrl: string;
  spawnedByUs: boolean;
  stop: () => Promise<void>;
};

// Ports claimed by more than one catalog entry. A bare "is something serving
// on :4321?" probe can't tell sjer-red from stocks-sjer-red (both bind 4321),
// so reusing whatever is already there could silently capture the wrong app.
// Reuse is only attempted when a package's expected port is unique to it.
const SHARED_PORTS = new Set(
  PACKAGES.map((p) => p.expectedPort).filter(
    (port, _i, all) => all.indexOf(port) !== all.lastIndexOf(port),
  ),
);

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

/**
 * Occupancy probe: is *anything* bound to `url`'s port? Unlike readiness, any
 * HTTP response (even a 5xx) counts as "in use"; only a connection failure
 * means the port is free. Used to decide whether we can spawn our own server
 * on the expected port.
 */
async function isPortInUse(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    await fetch(url, { signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
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
  const hasEnvOverrides =
    options.envOverrides !== undefined &&
    Object.keys(options.envOverrides).length > 0;
  const baseUrl = `http://localhost:${String(entry.expectedPort)}`;

  // Reuse an already-running server only when its expected port is unique to
  // this package (a shared-port probe can't confirm identity) and no --env
  // overrides force a fresh process (a running server can't retroactively pick
  // up new env vars like VITE_CONTRACT_HASH=...).
  const canReuse = !hasEnvOverrides && !SHARED_PORTS.has(entry.expectedPort);
  if (canReuse && (await probeReady(`${baseUrl}${readyPath}`, 500))) {
    return { baseUrl, spawnedByUs: false, stop: () => Promise.resolve() };
  }

  // We must spawn our own server, and it has to bind `expectedPort` for the URL
  // to be trustworthy. We deliberately do NOT read an auto-bumped port back
  // from stdout: dev commands print inconsistent/hard-coded banners (scout's
  // dev-web.sh prints a static http://localhost:5180, several print multiple
  // services), so a bound port parsed from output can't be trusted to be the
  // browser-facing server. Instead, require the expected port to be free and
  // let the child bind exactly it; if it's occupied, fail fast rather than
  // auto-bump to an unknown port or capture whatever is already there.
  if (await isPortInUse(`${baseUrl}/`, 500)) {
    const why = hasEnvOverrides
      ? "a fresh spawn is required to apply --env overrides, but the port is taken"
      : SHARED_PORTS.has(entry.expectedPort)
        ? "another catalog app shares this port"
        : "something is already bound there";
    throw new Error(
      `${entry.alias}: port ${String(entry.expectedPort)} is already in use (${why}). ` +
        `Stop whatever is on :${String(entry.expectedPort)} (or screenshot that app) and retry — ` +
        `toolkit screenshot binds a fixed port so it never captures the wrong server.`,
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
  const proc = Bun.spawn(entry.devCommand, {
    cwd: `${root}/${entry.cwd}`,
    env: { ...Bun.env, ...options.envOverrides },
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
      return { baseUrl, spawnedByUs: true, stop };
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
