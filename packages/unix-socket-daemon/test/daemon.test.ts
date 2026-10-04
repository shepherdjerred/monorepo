import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  daemonRunning,
  isDaemonPid,
  parseTtl,
  pathExists,
  pidAlive,
  processCommand,
  serveUnixDaemon,
  stopDaemonPid,
} from "#src/index.ts";

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
    expect(await daemonRunning(daemon.pid, "sleep 30")).toBe(true);
    expect(
      await stopDaemonPid(daemon.pid, { marker: "sleep 30", waitMs: 100 }),
    ).toBe("terminated");
    await daemon.exited;
    expect(pidAlive(daemon.pid)).toBe(false);
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
});
