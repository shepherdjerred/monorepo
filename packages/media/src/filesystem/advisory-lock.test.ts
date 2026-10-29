import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { withAdvisoryLock, withAdvisoryLocks } from "./advisory-lock.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture(count: number) {
  const directory = await mkdtemp(path.join(tmpdir(), "media-lock-batch-"));
  directories.push(directory);
  return Array.from({ length: count }, (_, index) =>
    path.join(directory, `${String(index)}.lock`),
  );
}
function helpers() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,args="], { encoding: "utf8" })
    .split("\n")
    .flatMap((row) => {
      const ids = /^(\d+)\s+(\d+)\s/u.exec(row.trim());
      return ids?.[1] !== undefined &&
        Number(ids[2]) === process.pid &&
        row.includes("lock-helper.py")
        ? [Number(ids[1])]
        : [];
    });
}
function assertKernelLocksHeld(paths: readonly string[]) {
  execFileSync(
    "python3",
    [
      "-I",
      "-c",
      `
import fcntl, json, os, sys
for path in json.load(sys.stdin):
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            continue
        raise AssertionError("Expected every exact path to remain locked")
    finally:
        os.close(fd)
`,
    ],
    { input: JSON.stringify(paths), env: {}, stdio: ["pipe", "pipe", "pipe"] },
  );
}

test("batches exclude legacy single-path locks and legacy locks exclude later batches", async () => {
  const paths = await fixture(130);
  const last = paths.at(-1);
  if (last === undefined) throw new Error("Missing final lock");
  await withAdvisoryLocks(paths, async (assertHeld) => {
    assertKernelLocksHeld(paths);
    await expect(
      withAdvisoryLock(last, () => Promise.resolve()),
    ).rejects.toMatchObject({ kind: "busy" });
    assertHeld();
  });
  await withAdvisoryLock(last, async () => {
    await expect(
      withAdvisoryLocks(paths, () => Promise.resolve()),
    ).rejects.toMatchObject({ kind: "busy" });
    // The failed second chunk released both its partial prefix and first chunk.
    await withAdvisoryLocks(paths.slice(0, -1), async (assertHeld) => {
      assertKernelLocksHeld(paths.slice(0, -1));
      assertHeld();
    });
  });
});

test("100 initial entries hold all 800 exact locks with bounded descriptor chunks", async () => {
  const paths = await fixture(100 * 8);
  const before = new Set(helpers());
  await withAdvisoryLocks(paths, async (assertHeld) => {
    expect(helpers().filter((pid) => !before.has(pid))).toHaveLength(
      Math.ceil(paths.length / 128),
    );
    assertKernelLocksHeld(paths);
    assertHeld();
  });
  expect(helpers().filter((pid) => !before.has(pid))).toEqual([]);
});

test("a bad lock path and a rejected callback release the entire acquired prefix", async () => {
  const paths = await fixture(130);
  const last = paths.at(-1);
  const first = paths[0];
  if (last === undefined || first === undefined)
    throw new Error("Missing paths");
  await writeFile(first, "");
  await symlink(first, last);
  await expect(
    withAdvisoryLocks(paths, () => Promise.resolve()),
  ).rejects.toMatchObject({ kind: "unavailable" });
  await rm(last);
  await expect(
    withAdvisoryLocks(paths, async () => {
      throw new Error("Rejected authority");
    }),
  ).rejects.toThrow("Rejected authority");
  await withAdvisoryLocks(paths, async (assertHeld) => {
    assertKernelLocksHeld(paths);
    assertHeld();
  });
});

test("losing any batch helper prevents subsequent effects and releases the other chunks", async () => {
  const paths = await fixture(130);
  const before = new Set(helpers());
  let effect = false;
  await expect(
    withAdvisoryLocks(paths, async (assertHeld) => {
      const owned = helpers().filter((pid) => !before.has(pid));
      expect(owned).toHaveLength(2);
      const first = owned[0];
      if (first === undefined) throw new Error("Missing batch helper");
      process.kill(first, "SIGKILL");
      await delay(30);
      assertHeld();
      effect = true;
    }),
  ).rejects.toMatchObject({ kind: "lost" });
  expect(effect).toBe(false);
  await withAdvisoryLocks(paths, async () => assertKernelLocksHeld(paths));
});

test("a killed owning process releases every chunk through pipe EOF", async () => {
  const paths = await fixture(130);
  const module = fileURLToPath(new URL("advisory-lock.ts", import.meta.url));
  const script = `import { withAdvisoryLocks } from ${JSON.stringify(module)};
await withAdvisoryLocks(${JSON.stringify(paths)}, async () => {
  console.log("locked");
  await new Promise(() => {});
});`;
  const child = spawn(process.execPath, ["--eval", script], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {},
  });
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Lock child did not become ready")),
        3000,
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (text: string) => {
        if (text.includes("locked\n")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Lock child exited before ready"));
      });
    });
    assertKernelLocksHeld(paths);
    child.kill("SIGKILL");
    await exited;
    await delay(30);
    await withAdvisoryLocks(paths, async () => assertKernelLocksHeld(paths));
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
});
