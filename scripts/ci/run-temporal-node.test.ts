import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { spawnManagedProcessGroup } from "../run-temporal-node.ts";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("spawnManagedProcessGroup", () => {
  let directory = "";

  afterEach(async () => {
    if (directory !== "") {
      await rm(directory, { recursive: true, force: true });
      directory = "";
    }
  });

  test("reaps orphaned grandchildren sharing the runner process group when worker exits abruptly", async () => {
    if (process.platform === "win32") return;
    directory = await mkdtemp(path.join(tmpdir(), "managed-pgid-reap-"));
    const pidFile = path.join(directory, "grandchild.pid");
    const workerScript = path.join(directory, "worker.ts");
    await Bun.write(
      workerScript,
      [
        'import { spawn } from "node:child_process";',
        `const pidFile = ${JSON.stringify(pidFile)};`,
        'const server = spawn("/bin/sh", ["-c", "exec -a temporal-test-server /bin/sleep 60"], { stdio: "ignore" });',
        "await Bun.sleep(50);",
        "await Bun.write(pidFile, String(server.pid));",
        "process.exit(2);",
      ].join("\n"),
    );

    const exitCode = await spawnManagedProcessGroup(
      [process.execPath, workerScript],
      {
        cwd: directory,
        env: Bun.env,
      },
    );
    expect(exitCode).toBe(2);

    const rawPid = await Bun.file(pidFile).text();
    const grandchildPid = Number(rawPid.trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);
    expect(grandchildPid).toBeGreaterThan(0);

    const deadline = Date.now() + 1000;
    while (isPidAlive(grandchildPid) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(isPidAlive(grandchildPid)).toBe(false);
  }, 15_000);
});
