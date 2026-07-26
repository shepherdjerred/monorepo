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

const BOUND_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/g;

// Ports claimed by more than one catalog entry. A bare "is something serving
// non-5xx on :4321?" probe can't tell sjer-red from stocks-sjer-red (both bind
// 4321), so reusing whatever is already there could silently capture the wrong
// app. Reuse is only attempted when a package's expected port is unique to it.
const SHARED_PORTS = new Set(
  PACKAGES.map((p) => p.expectedPort).filter(
    (port, _i, all) => all.indexOf(port) !== all.lastIndexOf(port),
  ),
);

async function probe(url: string, timeoutMs: number): Promise<boolean> {
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

async function waitForReady(
  baseUrl: string,
  readyPath: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(`${baseUrl}${readyPath}`, 2000)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `${baseUrl}${readyPath} did not become ready within ${String(timeoutMs)}ms`,
  );
}

export async function ensureDevServer(
  entry: PackageEntry,
  options: {
    envOverrides?: Record<string, string> | undefined;
    timeoutMs?: number | undefined;
  } = {},
): Promise<DevServerHandle> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const readyPath = entry.readyPath ?? entry.defaultRoute;
  const hasEnvOverrides =
    options.envOverrides !== undefined &&
    Object.keys(options.envOverrides).length > 0;

  // A running server can't retroactively pick up new env overrides
  // (e.g. --env VITE_CONTRACT_HASH=...), so always force a fresh spawn
  // when any are given. And only reuse when this package's expected port is
  // unique — on a shared port (4321, 5173) a probe can't confirm the running
  // server is actually the requested app, so spawn our own instead.
  const canReusePort = !SHARED_PORTS.has(entry.expectedPort);
  if (!hasEnvOverrides && canReusePort) {
    const reuseUrl = `http://localhost:${String(entry.expectedPort)}`;
    if (await probe(`${reuseUrl}${readyPath}`, 500)) {
      return {
        baseUrl: reuseUrl,
        spawnedByUs: false,
        stop: () => Promise.resolve(),
      };
    }
  }

  const root = await repoRoot();
  if (root === null) {
    throw new Error(
      "Not inside the monorepo (git rev-parse --show-toplevel failed or versions.ts is missing) — toolkit screenshot must run from within the repo checkout.",
    );
  }
  const proc = Bun.spawn(entry.devCommand, {
    cwd: `${root}/${entry.cwd}`,
    env: { ...Bun.env, ...options.envOverrides },
    stdout: "pipe",
    stderr: "pipe",
  });

  let combinedOutput = "";
  const discoveredPorts = new Set<number>();
  const readStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      combinedOutput += chunk;
      for (const match of chunk.matchAll(BOUND_URL_RE)) {
        const port = Number(match[1]);
        if (Number.isInteger(port)) {
          discoveredPorts.add(port);
        }
      }
    }
  };
  const stdoutDone = readStream(proc.stdout);
  const stderrDone = readStream(proc.stderr);

  // Prefer the URL bound to this package's expected browser port. Some dev
  // commands start several HTTP services (docs-board serves its API on 7331
  // before Vite on 7332); the first URL printed can be the wrong one, whose
  // "/" still passes the <500 readiness probe. Wait for the expected port to
  // appear; if the server auto-bumped (Astro/Vite pick the next free port),
  // fall back to the first URL seen after a short settle window.
  const settleMs = 3000;
  const deadline = Date.now() + timeoutMs;
  let firstSeenAt: number | undefined;
  while (Date.now() < deadline) {
    if (discoveredPorts.has(entry.expectedPort)) break;
    if (discoveredPorts.size > 0) {
      firstSeenAt ??= Date.now();
      if (Date.now() - firstSeenAt > settleMs) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const boundPort = discoveredPorts.has(entry.expectedPort)
    ? entry.expectedPort
    : [...discoveredPorts][0];
  const boundUrl =
    boundPort === undefined
      ? undefined
      : `http://localhost:${String(boundPort)}`;

  const stop = async () => {
    proc.kill();
    await Promise.race([
      proc.exited,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  };

  if (boundUrl === undefined) {
    await stop();
    throw new Error(
      `${entry.alias}: dev server did not print a bound localhost URL within ${String(timeoutMs)}ms.\n--- output ---\n${combinedOutput}`,
    );
  }

  try {
    await waitForReady(boundUrl, readyPath, Math.max(timeoutMs - 1000, 1000));
  } catch (error) {
    await stop();
    throw new Error(
      `${entry.alias}: ${error instanceof Error ? error.message : String(error)}\n--- output so far ---\n${combinedOutput}`,
      { cause: error },
    );
  }

  // Keep draining stdout/stderr in the background so the pipes never fill
  // up and stall the process; nothing awaits these beyond process exit.
  void stdoutDone;
  void stderrDone;

  return { baseUrl: boundUrl, spawnedByUs: true, stop };
}
