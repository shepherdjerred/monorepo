import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  ensurePostgresCluster,
  ensureSharedPostgres,
  postgresBinaryPath,
  psqlMaintenance,
  readPostmasterPid,
  runCommandSync,
  SHARED_PG_ROLES,
  sharedPostgresPort,
} from "./index.ts";

const PROTECTED_PORTS = new Set([5471, 5472, 5600]);
const activeClusters: string[] = [];
const tempDirs: string[] = [];

function stopClusterIfRunning(
  dataDir: string,
  mode: "fast" | "immediate" = "fast",
): void {
  if (Bun.file(path.join(dataDir, "PG_VERSION")).size === 0) {
    return;
  }
  runCommandSync([
    postgresBinaryPath("pg_ctl"),
    "-D",
    dataDir,
    "-m",
    mode,
    "-w",
    "-t",
    "15",
    "stop",
  ]);
}

afterEach(async () => {
  while (activeClusters.length > 0) {
    const dataDir = activeClusters.pop();
    if (dataDir !== undefined) {
      stopClusterIfRunning(dataDir, "immediate");
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  if (process.getuid?.() === 0) {
    await chmod(dir, 0o755);
  }
  tempDirs.push(dir);
  return dir;
}

async function allocateFreePort(
  exclude: ReadonlySet<number> = new Set(),
): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const srv = createServer();
      srv.once("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const address = srv.address();
        const chosen =
          address !== null && typeof address === "object" ? address.port : 0;
        srv.close((closeErr) => {
          if (closeErr === undefined || closeErr === null) {
            resolve(chosen);
          } else {
            reject(closeErr);
          }
        });
      });
    });
    if (port > 0 && !PROTECTED_PORTS.has(port) && !exclude.has(port)) {
      return port;
    }
  }
  throw new Error("Could not allocate an isolated free port");
}

async function zeroOutWalSegments(dataDir: string): Promise<void> {
  const walDir = path.join(dataDir, "pg_wal");
  const entries = await readdir(walDir);
  let corrupted = 0;
  for (const entry of entries) {
    if (!/^[0-9A-F]{24}$/u.test(entry)) {
      continue;
    }
    const walFile = path.join(walDir, entry);
    const info = await stat(walFile);
    await Bun.write(walFile, new Uint8Array(info.size));
    corrupted += 1;
  }
  expect(corrupted).toBeGreaterThan(0);
}

describe("isolated cluster discovery, conflict diagnostics, and WAL recovery", () => {
  test("isolates XDG_CACHE_HOME from HOME/.cache, auto-discovers live postmaster.pid port, and reports port conflicts without stopping the server", async () => {
    const fakeHome = await makeTempDir("test-pg-fake-home-");
    const scratchCache = await makeTempDir("test-pg-scratch-cache-");

    // Populate a dummy HOME/.cache/monorepo-test-pg/18/pgdata/PG_VERSION so any
    // fallback to HOME/.cache would fail initdb / startup immediately.
    await Bun.write(
      path.join(
        fakeHome,
        ".cache",
        "monorepo-test-pg",
        "18",
        "pgdata",
        "PG_VERSION",
      ),
      "18\n",
      { createPath: true },
    );

    const portA = await allocateFreePort();
    const portB = await allocateFreePort(new Set([portA]));
    const dataRoot = path.join(scratchCache, "monorepo-test-pg", "18");
    const dataDir = path.join(dataRoot, "pgdata");
    activeClusters.push(dataDir);
    const rootIsolation =
      process.getuid?.() === 0 ? { TEST_POSTGRES_DATA_ROOT: dataRoot } : {};

    const started = ensureSharedPostgres({
      HOME: fakeHome,
      XDG_CACHE_HOME: scratchCache,
      ...rootIsolation,
      LOCAL_TEST_PG_PORT: portA.toString(),
    });
    expect(started.port).toBe(portA);

    const pidInfo = readPostmasterPid(dataDir);
    expect(pidInfo?.port).toBe(portA);
    expect(pidInfo?.pid).toBeGreaterThan(0);

    // Without LOCAL_TEST_PG_PORT or SCOUT_PG_PORT, both sharedPostgresPort and
    // ensureSharedPostgres reuse the live postmaster.pid port automatically.
    const envWithoutPort = {
      HOME: fakeHome,
      XDG_CACHE_HOME: scratchCache,
      ...rootIsolation,
    };
    expect(sharedPostgresPort(envWithoutPort)).toBe(portA);
    const reused = ensureSharedPostgres(envWithoutPort);
    expect(reused.port).toBe(portA);

    // Requesting a different explicit port against the active dataDir throws a
    // clear diagnostic before pg_ctl start without disturbing the running server.
    expect(() =>
      ensureSharedPostgres({
        HOME: fakeHome,
        XDG_CACHE_HOME: scratchCache,
        ...rootIsolation,
        LOCAL_TEST_PG_PORT: portB.toString(),
      }),
    ).toThrow(
      `PostgreSQL data directory ${dataDir} is already running on port ${portA.toString()} (PID ${String(pidInfo?.pid)}), but port ${portB.toString()} was requested; set LOCAL_TEST_PG_PORT=${portA.toString()}`,
    );

    expect(psqlMaintenance("SELECT 1", { adminUrl: started.superUrl })).toBe(
      "1",
    );
    stopClusterIfRunning(dataDir, "fast");
  }, 60_000);

  test("auto-recovers disposable monorepo-test-pg/18/pgdata after a WAL checkpoint panic", async () => {
    const scratchCache = await makeTempDir("test-pg-wal-panic-");
    const port = await allocateFreePort();
    const dataRoot = path.join(scratchCache, "monorepo-test-pg", "18");
    const dataDir = path.join(dataRoot, "pgdata");
    activeClusters.push(dataDir);

    const env = {
      XDG_CACHE_HOME: scratchCache,
      ...(process.getuid?.() === 0
        ? { TEST_POSTGRES_DATA_ROOT: dataRoot }
        : {}),
      LOCAL_TEST_PG_PORT: port.toString(),
    };
    const initial = ensureSharedPostgres(env);
    psqlMaintenance("CREATE DATABASE pre_crash_sentinel", {
      adminUrl: initial.superUrl,
    });

    stopClusterIfRunning(dataDir, "immediate");
    await zeroOutWalSegments(dataDir);

    const recovered = ensureSharedPostgres(env);
    expect(recovered.port).toBe(port);
    expect(
      psqlMaintenance(
        "SELECT 1 FROM pg_database WHERE datname = 'pre_crash_sentinel'",
        { adminUrl: recovered.superUrl },
      ),
    ).toBe("");

    const recoveredLog = await Bun.file(
      path.join(dataRoot, "server.log.recovered"),
    ).text();
    expect(recoveredLog).toMatch(
      /PANIC:|could not locate a valid checkpoint record/iu,
    );

    for (const role of SHARED_PG_ROLES) {
      expect(
        psqlMaintenance(`SELECT 1 FROM pg_roles WHERE rolname = '${role}'`, {
          adminUrl: recovered.superUrl,
        }),
      ).toBe("1");
    }
    stopClusterIfRunning(dataDir, "fast");
  }, 60_000);

  test("runs durable clusters with fsync=on and full_page_writes=on and never auto-wipes on WAL panic", async () => {
    const durableBase = await makeTempDir("test-pg-durable-");
    const port = await allocateFreePort();
    const dataRoot = path.join(durableBase, "scout-for-lol", "postgres", "18");
    const dataDir = path.join(dataRoot, "pgdata");
    activeClusters.push(dataDir);

    const env = {
      XDG_DATA_HOME: durableBase,
      SCOUT_PG_PORT: port.toString(),
    };
    const clusterOptions = {
      port,
      explicitPortProvided: true,
      dataRoot,
      durability: "durable" as const,
      allowWalPanicWipe: false,
      allowedDataDirs: [dataDir],
      env,
      portEnvName: "SCOUT_PG_PORT",
      isolationEnvName: "XDG_DATA_HOME",
    };

    const started = ensurePostgresCluster(clusterOptions);
    expect(psqlMaintenance("SHOW fsync", { adminUrl: started.superUrl })).toBe(
      "on",
    );
    expect(
      psqlMaintenance("SHOW full_page_writes", {
        adminUrl: started.superUrl,
      }),
    ).toBe("on");

    stopClusterIfRunning(dataDir, "immediate");
    await zeroOutWalSegments(dataDir);
    const markerPath = path.join(dataDir, "DURABLE_MARKER_DO_NOT_WIPE");
    await Bun.write(markerPath, "keep-durable-data\n");

    expect(() => ensurePostgresCluster(clusterOptions)).toThrow(
      "pg_ctl start failed",
    );
    expect(await Bun.file(markerPath).text()).toBe("keep-durable-data\n");
  }, 60_000);
});

describe("UTC cluster timezone initialization and override", () => {
  test("initializes and starts clusters in UTC even when host TZ is non-UTC or postgresql.conf has non-UTC timezone", async () => {
    const scratchCache = await makeTempDir("test-pg-tz-");
    const port = await allocateFreePort();
    const dataRoot = path.join(scratchCache, "monorepo-test-pg", "18");
    const dataDir = path.join(dataRoot, "pgdata");
    activeClusters.push(dataDir);

    const moduleUrl = new URL("index.ts", import.meta.url).href;
    const child = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `const { ensureSharedPostgres } = await import(${JSON.stringify(moduleUrl)}); const res = ensureSharedPostgres(); process.stdout.write(res.superUrl);`,
      ],
      {
        env: {
          ...Bun.env,
          TZ: "America/Los_Angeles",
          XDG_CACHE_HOME: scratchCache,
          ...(process.getuid?.() === 0
            ? { TEST_POSTGRES_DATA_ROOT: dataRoot }
            : {}),
          LOCAL_TEST_PG_PORT: port.toString(),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (child.exitCode !== 0) {
      throw new Error(
        `Non-UTC child cluster bootstrap failed: ${child.stderr.toString()}`,
      );
    }
    const superUrl = child.stdout.toString().trim();

    expect(
      psqlMaintenance("SELECT current_setting('TimeZone')", {
        adminUrl: superUrl,
      }),
    ).toBe("UTC");

    const confPath = path.join(dataDir, "postgresql.conf");
    const initialConf = await Bun.file(confPath).text();
    expect(initialConf).toMatch(/^\s*timezone\s*=\s*'?UTC'?(?:\s|$|#)/mu);

    // Simulate an already-initialized local cluster whose postgresql.conf had America/Los_Angeles
    stopClusterIfRunning(dataDir, "fast");
    await Bun.write(
      confPath,
      `${initialConf}\ntimezone = 'America/Los_Angeles'\n`,
    );

    const restarted = ensureSharedPostgres({
      XDG_CACHE_HOME: scratchCache,
      ...(process.getuid?.() === 0
        ? { TEST_POSTGRES_DATA_ROOT: dataRoot }
        : {}),
      LOCAL_TEST_PG_PORT: port.toString(),
    });
    expect(
      psqlMaintenance("SELECT current_setting('TimeZone')", {
        adminUrl: restarted.superUrl,
      }),
    ).toBe("UTC");
    expect(
      psqlMaintenance("SELECT current_setting('TimeZone')", {
        adminUrl: `${restarted.superUrl}?options=${encodeURIComponent("-c timezone=America/Los_Angeles")}`,
      }),
    ).toBe("America/Los_Angeles");
    stopClusterIfRunning(dataDir, "fast");
  }, 60_000);
});
