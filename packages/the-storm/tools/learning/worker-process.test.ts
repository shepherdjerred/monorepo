import { expect, it } from "vitest";
import { WorkerBudget } from "./worker-process.ts";

function killOwnedGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }
}

async function readWithinDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("owned process pipe did not close")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

it("the watchdog terminates the private parent and its live descendant", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      'const leaf = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000); console.log(process.pid);"], { stdout: "inherit", stderr: "inherit" }); await leaf.exited;',
    ],
    {
      detached: true,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  const reader = child.stdout.getReader();
  let budget: WorkerBudget | undefined;
  try {
    const line = await readWithinDeadline(reader);
    if (line.done) throw new Error("owned descendant never started");
    const pid = Number(new TextDecoder().decode(line.value).trim());
    expect(Number.isInteger(pid) && pid > 1).toBe(true);
    expect(process.kill(pid, 0)).toBe(true);
    budget = new WorkerBudget(child, 100);
    expect(await child.exited).toBe(137);
    expect(budget.expired).toBe(true);
    // The live leaf holds the same pipe open. EOF proves the group kill also
    // terminated it, even when the OS has not reaped an orphaned zombie yet.
    const end = await readWithinDeadline(reader);
    expect(end.done).toBe(true);
    budget.stop(); // Already-reaped groups are safe to clean up again.
  } finally {
    budget?.stop();
    budget?.close();
    // A parent-only kill must not leak its descendant when this test fails.
    killOwnedGroup(child.pid);
    await child.exited;
    reader.releaseLock();
  }
});

it("manual cancellation stops an owned process and removes signal listeners", async () => {
  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  const child = Bun.spawn(
    [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    {
      detached: true,
      stdout: "ignore",
      stderr: "ignore",
    },
  );
  const budget = new WorkerBudget(child, 60_000);
  try {
    budget.stop();
    expect(await child.exited).toBe(137);
    expect(budget.expired).toBe(false);
  } finally {
    budget.stop();
    budget.close();
    await child.exited;
  }
  expect(process.listenerCount("SIGINT")).toBe(beforeInt);
  expect(process.listenerCount("SIGTERM")).toBe(beforeTerm);
});
