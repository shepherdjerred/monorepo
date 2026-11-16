import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const PROBE_SCRIPT = `
const net = require("node:net");
const candidates = process.argv.slice(1).map(Number);

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (inUse) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(150);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function tryBind(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(null));
    server.listen({ host, port, exclusive: true }, () => {
      const addr = server.address();
      const bound = addr && typeof addr === "object" ? addr.port : null;
      server.close(() => resolve(bound));
    });
  });
}

async function isFree(port) {
  if (await canConnect("127.0.0.1", port)) return false;
  if (await canConnect("::1", port)) return false;
  if ((await tryBind("127.0.0.1", port)) === null) return false;
  if ((await tryBind("0.0.0.0", port)) === null) return false;
  return true;
}

(async () => {
  for (const port of candidates) {
    if (await isFree(port)) {
      process.stdout.write(String(port));
      return;
    }
  }
  for (let i = 0; i < 16; i += 1) {
    const ephemeral = await tryBind("127.0.0.1", 0);
    if (
      ephemeral !== null &&
      !(await canConnect("::1", ephemeral)) &&
      (await tryBind("0.0.0.0", ephemeral)) !== null
    ) {
      process.stdout.write(String(ephemeral));
      return;
    }
  }
  process.exit(1);
})();
`;

/**
 * Stable worktree-hashed starting port in [20000, 49999] so concurrent checkouts
 * and distinct E2E servers (`namespace`) spread cleanly across unprivileged TCP
 * ports before probing for occupancy.
 */
export function worktreeBasePort(
  checkout: string,
  namespace = "default",
): number {
  const hash = createHash("sha256")
    .update(`${path.resolve(checkout)}:${namespace}`)
    .digest();
  return 20_000 + (hash.readUInt16BE(0) % 30_000);
}

/**
 * Cross-platform synchronous TCP connect/bind probe across IPv4 + IPv6 loopback
 * and wildcard interfaces (works on macOS, Linux, and Windows without `lsof`).
 */
export function findFreeLoopbackPortSync(
  candidates: readonly number[],
  excludedPorts: ReadonlySet<number> = new Set(),
): number {
  const filtered = candidates.filter(
    (port) => port >= 1 && port <= 65_535 && !excludedPorts.has(port),
  );
  const result = spawnSync(
    process.execPath,
    ["-e", PROBE_SCRIPT, ...filtered.map(String)],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `Failed to allocate a free E2E TCP port: ${result.stderr || "probe exited nonzero"}`,
    );
  }
  const parsed = Number(result.stdout.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      `Invalid port returned by E2E port probe: "${result.stdout}"`,
    );
  }
  return excludedPorts.has(parsed)
    ? findFreeLoopbackPortSync([parsed + 1], excludedPorts)
    : parsed;
}

export type ResolvedPlaywrightPort = {
  port: number;
  explicit: boolean;
  reuseExistingServer: boolean;
};

export function parseTcpPort(value: string, label: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(
      `${label} must be a valid TCP port (1-65535), got "${value}"`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      `${label} must be a valid TCP port (1-65535), got "${value}"`,
    );
  }
  return parsed;
}

/**
 * Resolve an isolated free E2E port for Playwright:
 * - If `env[envVar]` is explicitly set by the caller, validate and honor it,
 *   allowing `reuseExistingServer: !ci`.
 * - Otherwise select a worktree-hashed free TCP port, cache it in an internal
 *   env key so Playwright worker processes re-evaluating `playwright.config.ts`
 *   read the exact coordinator port, and force `reuseExistingServer: false`.
 */
export function resolvePlaywrightPort(options: {
  checkout: string;
  envVar: string;
  namespace?: string;
  ci?: boolean;
  excludedPorts?: readonly number[];
  env?: Record<string, string | undefined>;
}): ResolvedPlaywrightPort {
  const env = options.env ?? Bun.env;
  const ciEnv = env["CI"];
  const ci =
    options.ci ??
    (ciEnv !== undefined && ciEnv !== "" && ciEnv !== "0" && ciEnv !== "false");
  const rawExplicit = env[options.envVar];
  if (rawExplicit !== undefined && rawExplicit !== "") {
    const port = parseTcpPort(rawExplicit, options.envVar);
    return {
      port,
      explicit: true,
      reuseExistingServer: !ci,
    };
  }

  const cacheKey = `_PLAYWRIGHT_RESOLVED_${options.envVar}`;
  const cached = env[cacheKey];
  if (cached !== undefined && cached !== "") {
    return {
      port: parseTcpPort(cached, cacheKey),
      explicit: false,
      reuseExistingServer: false,
    };
  }

  const first = worktreeBasePort(
    options.checkout,
    options.namespace ?? options.envVar,
  );
  const candidates = Array.from({ length: 32 }, (_, offset) => {
    const candidate = first + offset;
    return candidate <= 65_535 ? candidate : 20_000 + (candidate % 30_000);
  });
  const port = findFreeLoopbackPortSync(
    candidates,
    new Set(options.excludedPorts),
  );
  env[cacheKey] = String(port);
  return {
    port,
    explicit: false,
    reuseExistingServer: false,
  };
}

if (import.meta.main) {
  const [checkout, envVar, ...excludedRaw] = Bun.argv.slice(2);
  if (checkout === undefined || envVar === undefined) {
    throw new Error(
      "Usage: bun e2e-port.ts <checkout> <envVar> [excludedPort...]",
    );
  }
  const excludedPorts = excludedRaw.map((value) =>
    parseTcpPort(value, "excludedPort"),
  );
  const resolved = resolvePlaywrightPort({ checkout, envVar, excludedPorts });
  process.stdout.write(
    `${String(resolved.port)}:${resolved.reuseExistingServer ? "1" : "0"}`,
  );
}
