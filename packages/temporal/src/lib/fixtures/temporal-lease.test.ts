import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  attachTemporalEnvironmentLease,
  findDirectTemporalServerChildPids,
  installTemporalTestEnvironmentLifecycle,
  reapDirectTemporalTestServerChildren,
  teardownActiveTemporalEnvironments,
} from "#lib/fixtures/temporal-lease.ts";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("attachTemporalEnvironmentLease", () => {
  let directory = "";

  afterEach(async () => {
    await teardownActiveTemporalEnvironments();
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  test("reuses one lease per TestWorkflowEnvironment and releases on teardown", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "temporal-env-lease-"));
    let toreDown = false;
    const fakeEnv = Object.assign(Object.create(null), {
      address: "127.0.0.1:41234",
      teardown: () => {
        toreDown = true;
        return Promise.resolve();
      },
    });

    const first = await attachTemporalEnvironmentLease(fakeEnv, {
      tendDir: directory,
      ttlMs: 60_000,
    });
    const second = await attachTemporalEnvironmentLease(fakeEnv, {
      tendDir: directory,
    });
    expect(second.id).toBe(first.id);
    expect(first.record.target).toBe("127.0.0.1:41234");

    await fakeEnv.teardown();
    expect(toreDown).toBe(true);
    await expect(stat(first.leasePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("auto-attaches leases to wrapped factories and tears down leaked environments", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "temporal-lifecycle-"));
    let timeSkippingTornDown = false;
    let localTornDown = false;

    const fakeTarget = {
      createTimeSkipping: () =>
        Promise.resolve(
          Object.assign(Object.create(null), {
            address: "127.0.0.1:42001",
            teardown: () => {
              timeSkippingTornDown = true;
              return Promise.resolve();
            },
          }),
        ),
      createLocal: () =>
        Promise.resolve(
          Object.assign(Object.create(null), {
            address: "127.0.0.1:42002",
            teardown: () => {
              localTornDown = true;
              return Promise.resolve();
            },
          }),
        ),
    };

    installTemporalTestEnvironmentLifecycle(fakeTarget, {
      tendDir: directory,
      ttlMs: 60_000,
    });
    installTemporalTestEnvironmentLifecycle(fakeTarget, {
      tendDir: directory,
    });

    await fakeTarget.createTimeSkipping();
    await fakeTarget.createLocal();
    const leasesDir = path.join(directory, "leases");
    const activeLeases = await readdir(leasesDir);
    expect(activeLeases).toHaveLength(2);

    await teardownActiveTemporalEnvironments();
    expect(timeSkippingTornDown).toBe(true);
    expect(localTornDown).toBe(true);
    expect(await readdir(leasesDir)).toEqual([]);
  });

  test("parses direct temporal-test-server children and ignores unrelated processes", () => {
    const samplePs = [
      "  101     1 /sbin/launchd",
      " 4200  4000 /opt/node/bin/node vitest.mjs",
      " 4201  4200 /Users/dev/.cache/temporal-test-server-sdk-typescript-1.26.0 51234",
      " 4202  4200 /bin/sleep 60",
      " 4203  9999 /Users/dev/.cache/temporal-test-server 59999",
    ].join("\n");

    expect(findDirectTemporalServerChildPids(samplePs, 4200, 4200)).toEqual([
      4201,
    ]);
    expect(reapDirectTemporalTestServerChildren(-1)).toEqual([]);
  });

  test("worker exit handler reaps direct temporal-test-server child processes cleanly", async () => {
    if (process.platform === "win32") return;
    directory = await mkdtemp(path.join(tmpdir(), "temporal-worker-reap-"));
    const pidFile = path.join(directory, "child.pid");
    const workerScript = path.join(directory, "worker.ts");
    const leaseModule = path.resolve(import.meta.dirname, "temporal-lease.ts");
    await Bun.write(
      workerScript,
      [
        'import { spawn } from "node:child_process";',
        `import { reapDirectTemporalTestServerChildren } from ${JSON.stringify(leaseModule)};`,
        "process.once('exit', () => { reapDirectTemporalTestServerChildren(); });",
        `const pidFile = ${JSON.stringify(pidFile)};`,
        'const server = spawn("/bin/sh", ["-c", "exec -a temporal-test-server /bin/sleep 60"], { stdio: "ignore" });',
        "await Bun.sleep(50);",
        "await Bun.write(pidFile, String(server.pid));",
        "process.exit(2);",
      ].join("\n"),
    );

    const worker = spawn(process.execPath, [workerScript], {
      cwd: directory,
      stdio: "ignore",
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      worker.once("exit", (code) => {
        resolve(code);
      });
    });
    expect(exitCode).toBe(2);

    const rawPid = await Bun.file(pidFile).text();
    const childPid = Number(rawPid.trim());
    expect(Number.isInteger(childPid)).toBe(true);
    expect(childPid).toBeGreaterThan(0);

    const deadline = Date.now() + 1000;
    while (isPidAlive(childPid) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(isPidAlive(childPid)).toBe(false);
  }, 15_000);
});
