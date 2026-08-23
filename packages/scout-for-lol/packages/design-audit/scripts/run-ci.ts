import path from "node:path";

const SHARD_COUNT = 16;
const POLL_INTERVAL_MS = 250;
const REQUEST_TIMEOUT_MS = 2000;

type ServerSpec = {
  readonly name: string;
  readonly command: string[];
  readonly cwd: string;
  readonly readyUrl: string;
  readonly timeoutMs: number;
  readonly environment?: Readonly<Record<string, string | undefined>>;
};

type ManagedServer = {
  readonly name: string;
  readonly process: Bun.Subprocess;
  readonly readyUrl: string;
  readonly timeoutMs: number;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function spawnServer(spec: ServerSpec): ManagedServer {
  return {
    name: spec.name,
    process: Bun.spawn(spec.command, {
      cwd: spec.cwd,
      env: spec.environment ?? Bun.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }),
    readyUrl: spec.readyUrl,
    timeoutMs: spec.timeoutMs,
  };
}

async function waitForServer(server: ManagedServer): Promise<void> {
  const startedAt = Date.now();
  let lastFailure = "no response";
  while (Date.now() - startedAt < server.timeoutMs) {
    if (server.process.exitCode !== null) {
      throw new Error(
        `${server.name} exited with code ${server.process.exitCode.toString()} before becoming ready`,
      );
    }
    try {
      const response = await fetch(server.readyUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return;
      lastFailure = `HTTP ${response.status.toString()}`;
    } catch (error) {
      lastFailure = describeError(error);
    }
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `${server.name} did not become ready at ${server.readyUrl} within ${server.timeoutMs.toString()}ms: ${lastFailure}`,
  );
}

function assertServersRunning(servers: readonly ManagedServer[]): void {
  for (const server of servers) {
    if (server.process.exitCode !== null) {
      throw new Error(
        `${server.name} exited with code ${server.process.exitCode.toString()} during the design audit`,
      );
    }
  }
}

async function stopServers(servers: readonly ManagedServer[]): Promise<void> {
  for (const server of servers) {
    if (server.process.exitCode === null) server.process.kill();
  }
  await Promise.all(servers.map(async (server) => await server.process.exited));
}

async function runAudit(): Promise<number> {
  const designAuditRoot = path.join(import.meta.dir, "..");
  const scoutRoot = path.join(designAuditRoot, "..", "..");
  const packagesRoot = path.join(scoutRoot, "packages");
  const servers = [
    spawnServer({
      name: "Scout marketing site",
      command: [
        "bun",
        "--no-install",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        "4321",
        "--ignore-lock",
      ],
      cwd: path.join(packagesRoot, "frontend"),
      readyUrl: "http://127.0.0.1:4321/",
      timeoutMs: 120_000,
      environment: { ...Bun.env, ASTRO_DEV_BACKGROUND: "0" },
    }),
    spawnServer({
      name: "Scout docs site",
      command: [
        "bun",
        "--no-install",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        "4322",
        "--ignore-lock",
      ],
      cwd: path.join(packagesRoot, "docs-site"),
      readyUrl: "http://127.0.0.1:4322/docs/",
      timeoutMs: 120_000,
      environment: { ...Bun.env, ASTRO_DEV_BACKGROUND: "0" },
    }),
    spawnServer({
      name: "Scout app and backend",
      command: [
        "bun",
        "--no-install",
        "run",
        "dev:design-audit",
        "--",
        "--no-discord-gateway",
      ],
      cwd: scoutRoot,
      readyUrl: "http://localhost:5180/api/version",
      timeoutMs: 300_000,
      environment: {
        ...Bun.env,
        SCOUT_DESIGN_AUDIT_LOCAL_BOOT: "true",
      },
    }),
  ] satisfies readonly ManagedServer[];

  const stop = (): void => {
    for (const server of servers) {
      if (server.process.exitCode === null) server.process.kill();
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    await Promise.all(
      servers.map(async (server) => {
        await waitForServer(server);
      }),
    );
    let status = 0;
    for (let shard = 1; shard <= SHARD_COUNT; shard += 1) {
      assertServersRunning(servers);
      const test = Bun.spawn(
        [
          "bun",
          "--no-install",
          "--bun",
          "playwright",
          "test",
          `--shard=${shard.toString()}/${SHARD_COUNT.toString()}`,
        ],
        {
          cwd: designAuditRoot,
          env: {
            ...Bun.env,
            SCOUT_DESIGN_AUDIT_APP_URL: "http://localhost:5180",
            SCOUT_DESIGN_AUDIT_DOCS_URL: "http://127.0.0.1:4322",
            SCOUT_DESIGN_AUDIT_MODE: "nightly",
            SCOUT_DESIGN_AUDIT_PUBLIC_URL: "http://127.0.0.1:4321",
            SCOUT_DESIGN_AUDIT_SHARD: shard.toString(),
          },
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        },
      );
      const currentStatus = await test.exited;
      if (currentStatus !== 0 && (status === 0 || currentStatus !== 1)) {
        status = currentStatus;
      }
    }
    return status;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await stopServers(servers);
  }
}

process.exitCode = await runAudit();
