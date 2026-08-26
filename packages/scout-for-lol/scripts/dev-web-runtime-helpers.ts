type DevWebOptions = {
  readonly backendPort: number;
  readonly webPort: number;
};

export const BACKEND_START_TIMEOUT_MS = 300_000;
export const DEFAULT_DESIGN_AUDIT_LAKE_DIR = "./.design-audit-report-lake";

export function sharedServerDatabaseName(
  databaseUrl: string,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const pgPort = environment["SCOUT_PG_PORT"] ?? "5471";
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return undefined;
  }
  const isLoopback =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!isLoopback || parsed.port !== pgPort) return undefined;
  const dbName = parsed.pathname.replace(/^\//, "");
  return /^[a-z][a-z0-9_]*$/.test(dbName) ? dbName : undefined;
}

export function printHelp(): void {
  console.log(`Usage: bun run dev:web -- [options]

Options:
  --backend-port <port>  Backend port (default: 3000)
  --web-port <port>      Vite SPA port (default: 5180)
  --database-url <url>   Postgres URL (default: scout_dev_<backend-port> on
                         the shared local dev server, port 5471 / SCOUT_PG_PORT)
  --temporal-port <port> Temporal gRPC port (default: backend port + 4233)
  --temporal-ui-port <port> Temporal UI port (default: backend port + 5233)
  --no-discord-gateway   Run as a secondary UI/API copy without BETA gateway
  --no-backend-watch     Keep the backend stable until this command is restarted
  --marketing-origin <url>  Marketing site origin for cross-surface links
  --docs-origin <url>       Docs site origin for cross-surface links
  --help                 Show this help

For a second copy, choose different ports. Its database defaults to
scout_dev_<backend-port> on the shared local Postgres. The BETA Discord gateway still has one
owner: run one gateway owner and pass --no-discord-gateway to secondary copies.
Secondary copies do not have the live bot guild/channel cache, so guild-picker
and channel-picker flows require the gateway owner.`);
}

export function origins(options: DevWebOptions): {
  readonly backendOrigin: string;
  readonly webOrigin: string;
} {
  return {
    backendOrigin: `http://127.0.0.1:${options.backendPort.toString()}`,
    webOrigin: `http://localhost:${options.webPort.toString()}`,
  };
}

export async function waitForBackend(
  backendOrigin: string,
  backend: Bun.Subprocess,
): Promise<void> {
  const startedAt = Date.now();
  let lastFailure: unknown;
  while (Date.now() - startedAt < BACKEND_START_TIMEOUT_MS) {
    if (backend.exitCode !== null) {
      throw new Error(
        `Scout backend exited with code ${backend.exitCode.toString()} before becoming ready`,
      );
    }
    try {
      const response = await fetch(`${backendOrigin}/api/version`);
      if (response.ok) return;
      lastFailure = new Error(
        `Scout backend readiness returned HTTP ${response.status.toString()}`,
      );
    } catch (error) {
      lastFailure = error;
    }
    await Bun.sleep(250);
  }
  throw new Error(
    `Scout backend did not become ready within ${BACKEND_START_TIMEOUT_MS.toString()}ms`,
    { cause: lastFailure },
  );
}

export async function waitForTemporal(
  temporalUiPort: number,
  temporal: Bun.Subprocess,
): Promise<void> {
  const startedAt = Date.now();
  let lastFailure: unknown;
  while (Date.now() - startedAt < BACKEND_START_TIMEOUT_MS) {
    if (temporal.exitCode !== null) {
      throw new Error(
        `Temporal dev server exited with code ${temporal.exitCode.toString()} before becoming ready`,
      );
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${temporalUiPort.toString()}/`,
      );
      if (response.ok) return;
      lastFailure = new Error(
        `Temporal UI readiness returned HTTP ${response.status.toString()}`,
      );
    } catch (error: unknown) {
      lastFailure = error;
    }
    await Bun.sleep(250);
  }
  throw new Error("Temporal dev server did not become ready", {
    cause: lastFailure,
  });
}

export function pinnedTemporalExecutable(root: string): string {
  const result = Bun.spawnSync(["mise", "which", "temporal"], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    throw new Error("mise could not resolve the pinned Temporal CLI");
  }
  const executable = result.stdout.toString().trim();
  if (executable.length === 0) {
    throw new Error("mise returned an empty Temporal CLI path");
  }
  return executable;
}
