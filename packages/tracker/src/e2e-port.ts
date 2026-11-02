import { createHash } from "node:crypto";
import path from "node:path";

/** Stable port for one checkout. Worktrees hash to different ports. */
export function e2ePort(checkout: string): number {
  const hash = createHash("sha256").update(path.resolve(checkout)).digest();
  return 20_000 + (hash.readUInt16BE(0) % 30_000);
}

/**
 * Playwright's webServer cwd is the config directory, so a listener is this
 * checkout when its cwd is the repo root or any directory under it.
 */
export function sameCheckout(
  checkout: string,
  listenerDirectory: string,
): boolean {
  const root = path.resolve(checkout);
  const cwd = path.resolve(listenerDirectory);
  return cwd === root || cwd.startsWith(root + path.sep);
}

/**
 * CI always uses the hashed port and starts a fresh server. Locally, reuse a
 * listener from this checkout and otherwise take the next free port. A foreign
 * checkout keeps its port; this config does not try to bind it.
 */
export function selectE2ePort(
  checkout: string,
  ci: boolean,
  occupied: (port: number) => string | null,
): number {
  const first = e2ePort(checkout);
  if (ci) return first;
  for (let offset = 0; offset < 20; offset += 1) {
    const port = first + offset;
    const cwd = occupied(port);
    if (cwd === null || sameCheckout(checkout, cwd)) return port;
  }
  throw new Error(
    `No free Tracker e2e port near ${String(first)} for ${checkout}`,
  );
}

function lsof(args: readonly string[]): { code: number; stdout: string } {
  const result = Bun.spawnSync(["lsof", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(
      `lsof ${args.join(" ")} failed (${String(result.exitCode)}): ${result.stderr.toString() || "missing executable"}`,
    );
  }
  return { code: result.exitCode, stdout: result.stdout.toString() };
}

/** cwd of the process listening on `port`, or null when nothing is listening. */
export function listenerCwd(port: number): string | null {
  const listed = lsof(["-nP", `-iTCP:${String(port)}`, "-sTCP:LISTEN", "-Fp"]);
  if (listed.code === 1) return null;
  const pid = listed.stdout
    .split("\n")
    .find((line) => line.startsWith("p"))
    ?.slice(1);
  if (pid === undefined || pid.length === 0) return null;
  const cwd = lsof(["-a", "-p", pid, "-d", "cwd", "-Fn"]);
  if (cwd.code === 1) return null;
  const directory = cwd.stdout
    .split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
  return directory === undefined || directory.length === 0 ? null : directory;
}
