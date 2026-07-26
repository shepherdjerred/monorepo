/**
 * Boot (or reuse) a registered package's dev server for `toolkit screenshot`.
 */
import { repoRoot } from "#lib/deployed/git.ts";
import type { PackageEntry } from "./types.ts";

export type DevServerHandle = {
  baseUrl: string;
  spawnedByUs: boolean;
  stop: () => Promise<void>;
};

const BOUND_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?/;

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
  // when any are given.
  if (!hasEnvOverrides) {
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
  let boundUrl: string | undefined;
  const readStream = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      combinedOutput += chunk;
      if (boundUrl === undefined) {
        const match = BOUND_URL_RE.exec(chunk);
        const port = match?.[1];
        if (port !== undefined) {
          boundUrl = `http://localhost:${port}`;
        }
      }
    }
  };
  const stdoutDone = readStream(proc.stdout);
  const stderrDone = readStream(proc.stderr);

  const deadline = Date.now() + timeoutMs;
  while (boundUrl === undefined && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

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
