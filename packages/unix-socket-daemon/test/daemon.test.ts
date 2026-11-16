import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AlreadyRunningError,
  daemonRunning,
  isDaemonPid,
  parseTtl,
  pathExists,
  pidAlive,
  processCommand,
  serveUnixDaemon,
  stopDaemonPid,
  terminateDaemonChild,
  withDaemonStartLock,
} from "#src/index.ts";

const PACKAGE_SRC_INDEX = path.resolve(import.meta.dir, "../src/index.ts");

const recordedExitCodes: number[] = [];

function noopExit(code: number): void {
  recordedExitCodes.push(code);
}

function readNumericPid(value: unknown): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "pid" && typeof entry === "number" && Number.isInteger(entry)) {
      return entry;
    }
  }
  return null;
}

async function probeStatusPid(socketPath: string): Promise<number | null> {
  if (!(await pathExists(socketPath))) {
    return null;
  }
  try {
    const response = await fetch("http://daemon/status", {
      unix: socketPath,
      signal: AbortSignal.timeout(1500),
    });
    return response.ok ? readNumericPid(await response.json()) : null;
  } catch {
    return null;
  }
}

async function writeMockDaemonScript(dir: string): Promise<string> {
  const scriptPath = path.join(dir, "mock-daemon-entry.ts");
  const source = [
    `import { appendFile } from "node:fs/promises";`,
    `import { serveUnixDaemon } from ${JSON.stringify(PACKAGE_SRC_INDEX)};`,
    `const [socketPath, statePath, spawnsLog, delayMsRaw] = process.argv.slice(2);`,
    `if (!socketPath || !statePath || !spawnsLog) { process.exit(2); }`,
    `const delayMs = Number.parseInt(delayMsRaw ?? "120", 10);`,
    `await appendFile(spawnsLog, \`\${String(process.pid)}\\n\`);`,
    `if (delayMs > 0) { await Bun.sleep(delayMs); }`,
    `await serveUnixDaemon({`,
    `  socketPath,`,
    `  statePath,`,
    `  state: { pid: process.pid },`,
    `  marker: "mock-daemon-entry.ts",`,
    `  ttlSeconds: 120,`,
    `  lastActivity: () => Date.now(),`,
    `  handle: (url) => {`,
    `    if (url.pathname === "/status") {`,
    `      return Response.json({ pid: process.pid, ok: true });`,
    `    }`,
    `    return new Response("not found", { status: 404 });`,
    `  },`,
    `  onShutdown: async () => {},`,
    `  log: () => {},`,
    `});`,
  ].join("\n");
  await writeFile(scriptPath, source, "utf8");
  return scriptPath;
}

describe("parseTtl", () => {
  test.each([
    ["30", 30],
    ["45s", 45],
    ["90m", 5400],
    ["4h", 14_400],
    [" 2h ", 7200],
  ])("%s → %d seconds", (raw, seconds) => {
    expect(parseTtl(raw)).toBe(seconds);
  });

  test.each(["", "4d", "-5m", "1.5h"])("rejects %j", (raw) => {
    expect(() => parseTtl(raw)).toThrow(/Invalid TTL/);
  });
});

describe("process identity", () => {
  test("reads this process's command line", async () => {
    const command = await processCommand(process.pid);
    expect(command).not.toBeNull();
    expect(pidAlive(process.pid)).toBe(true);
  });

  test("a status-reported PID decides identity without ps", async () => {
    expect(await isDaemonPid(4242, { statusPid: 4242, marker: "unused" })).toBe(
      true,
    );
    expect(await isDaemonPid(4242, { statusPid: 4243, marker: "unused" })).toBe(
      false,
    );
  });

  test("a live process without the marker is not the daemon", async () => {
    expect(
      await isDaemonPid(process.pid, {
        marker: "definitely-not-in-this-command-line/daemon/main.ts",
      }),
    ).toBe(false);
  });

  test("a dead PID is not the daemon", async () => {
    const child = Bun.spawn(["true"]);
    await child.exited;
    expect(await isDaemonPid(child.pid, { marker: "true" })).toBe(false);
  });
});

describe("stopDaemonPid", () => {
  test("never signals a live process that is not the daemon", async () => {
    // A stale state file whose PID now belongs to an unrelated process.
    const sleeper = Bun.spawn(["sleep", "30"]);
    try {
      expect(
        await stopDaemonPid(sleeper.pid, {
          marker: "packages/mc-harness/src/daemon/main.ts",
          waitMs: 100,
        }),
      ).toBe("stale");
      expect(pidAlive(sleeper.pid)).toBe(true);
      expect(await daemonRunning(sleeper.pid, "mc-harness/src/daemon")).toBe(
        false,
      );
    } finally {
      sleeper.kill();
      await sleeper.exited;
    }
  });

  test("terminates the daemon when it ignores shutdown", async () => {
    const daemon = Bun.spawn(["sleep", "30"]);
    try {
      // Linux can expose the PID before the child's command line is ready.
      await expect.poll(() => daemonRunning(daemon.pid, "sleep 30")).toBe(true);
      expect(
        await stopDaemonPid(daemon.pid, { marker: "sleep 30", waitMs: 100 }),
      ).toBe("terminated");
      await daemon.exited;
      expect(pidAlive(daemon.pid)).toBe(false);
    } finally {
      if (daemon.exitCode === null) {
        daemon.kill();
      }
      await daemon.exited;
    }
  });

  test("reports not-running for missing or dead PIDs", async () => {
    expect(await stopDaemonPid(null, { marker: "x", waitMs: 0 })).toBe(
      "not-running",
    );
    const done = Bun.spawn(["true"]);
    await done.exited;
    expect(await stopDaemonPid(done.pid, { marker: "true", waitMs: 0 })).toBe(
      "not-running",
    );
  });
});

describe("serveUnixDaemon", () => {
  let dir = "";
  const logged: string[] = [];
  afterEach(async () => {
    if (dir !== "") {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  test("serves, writes 0600 state, ticks, and cleans up on /shutdown", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "usd-"));
    const socketPath = path.join(dir, "d.sock");
    const statePath = path.join(dir, "state", "state.json");
    let ticks = 0;
    let tornDown = false;
    const exited = Promise.withResolvers<number>();
    await serveUnixDaemon({
      socketPath,
      statePath,
      state: { pid: process.pid },
      ttlSeconds: 3600,
      lastActivity: () => Date.now(),
      handle: (url) => Response.json({ path: url.pathname }),
      onShutdown: () => {
        tornDown = true;
        return Promise.resolve();
      },
      onTick: () => {
        ticks += 1;
        return Promise.resolve();
      },
      log: (msg) => {
        logged.push(msg);
      },
      tickMs: 20,
      exit: (code) => {
        exited.resolve(code);
      },
      handleSignals: false,
    });

    const response = await fetch("http://daemon/status", { unix: socketPath });
    expect(await response.json()).toEqual({ path: "/status" });
    const socketStat = await stat(socketPath);
    const stateStat = await stat(statePath);
    expect(socketStat.mode & 0o777).toBe(0o600);
    expect(stateStat.mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      pid: process.pid,
    });
    await Bun.sleep(100);
    expect(ticks).toBeGreaterThan(0);

    await fetch("http://daemon/shutdown", { method: "POST", unix: socketPath });
    expect(await exited.promise).toBe(0);
    expect(tornDown).toBe(true);
    expect(await pathExists(socketPath)).toBe(false);
    expect(await pathExists(statePath)).toBe(false);
  });

  test("shuts down once idle past the TTL", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "usd-"));
    const exited = Promise.withResolvers<number>();
    await serveUnixDaemon({
      socketPath: path.join(dir, "d.sock"),
      statePath: path.join(dir, "state.json"),
      state: {},
      ttlSeconds: 0,
      lastActivity: () => Date.now() - 1000,
      handle: () => new Response("unused"),
      onShutdown: () => Promise.resolve(),
      log: (msg) => {
        logged.push(msg);
      },
      tickMs: 10,
      exit: (code) => {
        exited.resolve(code);
      },
      handleSignals: false,
    });
    expect(await exited.promise).toBe(0);
  });

  test("refuses to unlink a live daemon's socket when a second serveUnixDaemon starts", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "usd-"));
    const socketPath = path.join(dir, "d.sock");
    const statePath = path.join(dir, "state.json");
    const first = await serveUnixDaemon({
      socketPath,
      statePath,
      state: { pid: process.pid },
      ttlSeconds: 3600,
      lastActivity: () => Date.now(),
      handle: (url) =>
        url.pathname === "/status"
          ? Response.json({ pid: process.pid, instance: "first" })
          : new Response("ok"),
      onShutdown: () => Promise.resolve(),
      log: (msg) => {
        logged.push(msg);
      },
      exit: noopExit,
      handleSignals: false,
    });

    try {
      await expect(
        serveUnixDaemon({
          socketPath,
          statePath,
          state: { pid: process.pid },
          ttlSeconds: 3600,
          lastActivity: () => Date.now(),
          handle: () => Response.json({ instance: "second" }),
          onShutdown: () => Promise.resolve(),
          log: (msg) => {
            logged.push(msg);
          },
          exit: noopExit,
          handleSignals: false,
        }),
      ).rejects.toThrow(AlreadyRunningError);

      expect(await pathExists(socketPath)).toBe(true);
      const response = await fetch("http://daemon/status", {
        unix: socketPath,
      });
      expect(await response.json()).toEqual({
        pid: process.pid,
        instance: "first",
      });
    } finally {
      await first.shutdown("test complete");
    }
  });

  test("refuses to unlink socket when statePath names a live matching daemon PID", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "usd-"));
    const socketPath = path.join(dir, "d.sock");
    const statePath = path.join(dir, "state.json");
    const liveMatchingDaemon = Bun.spawn(["sleep", "30"]);
    try {
      await expect
        .poll(() => daemonRunning(liveMatchingDaemon.pid, "sleep 30"))
        .toBe(true);
      await writeFile(
        statePath,
        JSON.stringify({ pid: liveMatchingDaemon.pid }),
        "utf8",
      );
      await writeFile(socketPath, "placeholder", "utf8");

      await expect(
        serveUnixDaemon({
          socketPath,
          statePath,
          state: { pid: process.pid },
          entryMatch: "sleep 30",
          ttlSeconds: 3600,
          lastActivity: () => Date.now(),
          handle: () => new Response("unused"),
          onShutdown: () => Promise.resolve(),
          log: (msg) => {
            logged.push(msg);
          },
          exit: noopExit,
          handleSignals: false,
        }),
      ).rejects.toThrow(AlreadyRunningError);

      expect(await pathExists(socketPath)).toBe(true);
    } finally {
      liveMatchingDaemon.kill();
      await liveMatchingDaemon.exited;
    }
  });
});

function registerDaemonTestCleanup(): {
  createTempDir: (prefix: string) => Promise<string>;
  trackPid: (pid: number | undefined) => void;
} {
  let dir = "";
  const trackedPids = new Set<number>();

  afterEach(async () => {
    for (const pid of trackedPids) {
      await terminateDaemonChild(pid, { graceMs: 100 });
    }
    trackedPids.clear();
    if (dir !== "") {
      await rm(dir, { recursive: true, force: true });
      dir = "";
    }
  });

  return {
    async createTempDir(prefix: string): Promise<string> {
      dir = await mkdtemp(path.join(tmpdir(), prefix));
      return dir;
    },
    trackPid(pid: number | undefined): void {
      if (pid !== undefined) {
        trackedPids.add(pid);
      }
    },
  };
}

describe("withDaemonStartLock concurrency", () => {
  const { createTempDir, trackPid } = registerDaemonTestCleanup();

  test("5 concurrent callers serialize via withDaemonStartLock, spawn 1 daemon, and all 5 connect", async () => {
    const dir = await createTempDir("usd-race-");
    const socketPath = path.join(dir, "daemon.sock");
    const statePath = path.join(dir, "state.json");
    const lockPath = `${socketPath}.lock`;
    const spawnsLog = path.join(dir, "spawns.log");
    const entryScript = await writeMockDaemonScript(dir);

    const startOrAttach = async (): Promise<{
      pid: number;
      started: boolean;
    }> => {
      const fastPid = await probeStatusPid(socketPath);
      if (fastPid !== null) {
        return { pid: fastPid, started: false };
      }

      return await withDaemonStartLock(
        { lockPath, timeoutMs: 10_000, pollMs: 25 },
        async () => {
          const existingPid = await probeStatusPid(socketPath);
          if (existingPid !== null) {
            return { pid: existingPid, started: false };
          }

          await rm(socketPath, { force: true });
          await rm(statePath, { force: true });

          const child = spawn(
            process.execPath,
            ["run", entryScript, socketPath, statePath, spawnsLog, "120"],
            { detached: true, stdio: "ignore" },
          );
          trackPid(child.pid);

          try {
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
              await Bun.sleep(40);
              if (child.exitCode !== null) {
                throw new Error(
                  `mock daemon exited early: ${String(child.exitCode)}`,
                );
              }
              const readyPid = await probeStatusPid(socketPath);
              if (readyPid !== null) {
                return { pid: readyPid, started: true };
              }
            }
            throw new Error("mock daemon timed out");
          } catch (error) {
            await terminateDaemonChild(child.pid, { graceMs: 200 });
            throw error;
          } finally {
            child.unref();
          }
        },
      );
    };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => startOrAttach()),
    );

    const startedCallers = results.filter((result) => result.started);
    const attachedCallers = results.filter((result) => !result.started);
    expect(startedCallers).toHaveLength(1);
    expect(attachedCallers).toHaveLength(4);

    const daemonPid = startedCallers[0]?.pid;
    expect(daemonPid).toBeDefined();
    for (const result of results) {
      expect(result.pid).toBe(daemonPid);
      const check = await fetch("http://daemon/status", { unix: socketPath });
      expect(await check.json()).toEqual({ pid: daemonPid, ok: true });
    }

    const spawnsContent = await readFile(spawnsLog, "utf8");
    const spawnedLines = spawnsContent
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
    expect(spawnedLines).toHaveLength(1);
    expect(await pathExists(lockPath)).toBe(false);
  });

  test("breaks stale locks from dead or recycled PIDs without stealing live owners", async () => {
    const dir = await createTempDir("usd-stale-lock-");
    const lockPath = path.join(dir, "daemon.sock.lock");

    const exited = Bun.spawn(["true"]);
    await exited.exited;
    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(lockPath, "owner.pid"),
      JSON.stringify({
        pid: exited.pid,
        timestamp: Date.now(),
        token: "dead-owner",
      }),
      "utf8",
    );

    const ranAfterDeadLock = await withDaemonStartLock(
      { lockPath, timeoutMs: 5000, pollMs: 15 },
      () => Promise.resolve("recovered-dead"),
    );
    expect(ranAfterDeadLock).toBe("recovered-dead");

    await mkdir(lockPath, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(lockPath, "owner.pid"),
      JSON.stringify({
        pid: process.pid,
        timestamp: Date.now() - 5000,
        token: "recycled-owner",
        identity: `${String(process.pid)}:recycled-stale-incarnation`,
      }),
      "utf8",
    );

    const ranAfterRecycledLock = await withDaemonStartLock(
      { lockPath, timeoutMs: 200, pollMs: 15 },
      () => Promise.resolve("recovered-recycled"),
    );
    expect(ranAfterRecycledLock).toBe("recovered-recycled");

    const releaseFirst = Promise.withResolvers<boolean>();
    const firstEntered = Promise.withResolvers<boolean>();
    const firstRun = withDaemonStartLock(
      { lockPath, timeoutMs: 50, pollMs: 15 },
      async () => {
        firstEntered.resolve(true);
        await releaseFirst.promise;
        return "first-owner";
      },
    );
    await firstEntered.promise;
    await Bun.sleep(100);
    await expect(
      withDaemonStartLock(
        { lockPath, timeoutMs: 50, waitMs: 90, pollMs: 15 },
        () => Promise.resolve("stole-live-lock"),
      ),
    ).rejects.toThrow("Timed out after 90ms waiting for daemon startup lock");
    releaseFirst.resolve(true);
    expect(await firstRun).toBe("first-owner");
    expect(await pathExists(lockPath)).toBe(false);

    let attempts = 0;
    await expect(
      withDaemonStartLock({ lockPath, timeoutMs: 1000, pollMs: 15 }, () => {
        attempts += 1;
        return Promise.reject(
          Object.assign(new Error("callback EEXIST"), { code: "EEXIST" }),
        );
      }),
    ).rejects.toThrow("callback EEXIST");
    expect(attempts).toBe(1);
    expect(await pathExists(lockPath)).toBe(false);
  });
});

describe("daemon crash and timeout recovery", () => {
  const { createTempDir, trackPid } = registerDaemonTestCleanup();

  test("recovers automatically when dead state.json and daemon.sock remain from a crashed daemon", async () => {
    const dir = await createTempDir("usd-crash-");
    const socketPath = path.join(dir, "daemon.sock");
    const statePath = path.join(dir, "state.json");
    const lockPath = `${socketPath}.lock`;
    const spawnsLog = path.join(dir, "spawns.log");
    const entryScript = await writeMockDaemonScript(dir);

    const crashed = spawn(
      process.execPath,
      ["run", entryScript, socketPath, statePath, spawnsLog, "0"],
      { detached: true, stdio: "ignore" },
    );
    const crashedPid = crashed.pid;
    expect(crashedPid).toBeDefined();
    trackPid(crashedPid);
    await expect.poll(() => probeStatusPid(socketPath)).toBe(crashedPid);
    crashed.unref();

    if (crashedPid !== undefined) {
      try {
        process.kill(-crashedPid, "SIGKILL");
      } catch {
        process.kill(crashedPid, "SIGKILL");
      }
    }
    await expect.poll(() => pidAlive(crashedPid ?? -1)).toBe(false);

    expect(await pathExists(socketPath)).toBe(true);
    expect(await pathExists(statePath)).toBe(true);

    const recoveredPid = await withDaemonStartLock(
      { lockPath, timeoutMs: 10_000 },
      async () => {
        expect(await probeStatusPid(socketPath)).toBeNull();
        await rm(socketPath, { force: true });
        await rm(statePath, { force: true });

        const replacement = spawn(
          process.execPath,
          ["run", entryScript, socketPath, statePath, spawnsLog, "0"],
          { detached: true, stdio: "ignore" },
        );
        trackPid(replacement.pid);
        replacement.unref();
        await expect
          .poll(() => probeStatusPid(socketPath))
          .toBe(replacement.pid);
        return replacement.pid ?? 0;
      },
    );

    expect(recoveredPid).not.toBe(crashedPid);
    expect(await probeStatusPid(socketPath)).toBe(recoveredPid);
  });

  test("kills a wedged child with SIGTERM -> SIGKILL when startup times out", async () => {
    const dir = await createTempDir("usd-timeout-");
    const socketPath = path.join(dir, "daemon.sock");
    const lockPath = `${socketPath}.lock`;

    const wedgedScript = path.join(dir, "wedged.ts");
    await writeFile(
      wedgedScript,
      [`process.on("SIGTERM", () => {});`, `setInterval(() => {}, 1000);`].join(
        "\n",
      ),
      "utf8",
    );

    let spawnedPid: number | undefined;
    await expect(
      withDaemonStartLock({ lockPath, timeoutMs: 5000 }, async () => {
        const child = spawn(process.execPath, ["run", wedgedScript], {
          detached: true,
          stdio: "ignore",
        });
        spawnedPid = child.pid;
        trackPid(spawnedPid);

        try {
          const deadline = Date.now() + 250;
          while (Date.now() < deadline) {
            await Bun.sleep(40);
            if ((await probeStatusPid(socketPath)) !== null) {
              return;
            }
          }
          throw new Error("daemon did not become ready in time");
        } catch (error) {
          await terminateDaemonChild(child.pid, { graceMs: 150 });
          throw error;
        } finally {
          child.unref();
        }
      }),
    ).rejects.toThrow("daemon did not become ready in time");

    expect(spawnedPid).toBeDefined();
    expect(pidAlive(spawnedPid ?? -1)).toBe(false);
  });
});
