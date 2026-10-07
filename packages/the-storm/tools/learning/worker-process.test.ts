import { expect, it } from "vitest";
import { WorkerBudget } from "./worker-process.ts";

async function descendantState(pid: number) {
  const probe = Bun.spawn(["ps", "-o", "stat=", "-p", pid.toString()], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(probe.stdout).text();
  const state = text.trim();
  const status = await probe.exited;
  return status === 0 ? state : "absent";
}

it("the watchdog terminates the private parent and its live descendant", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      'const leaf = Bun.spawn(["sleep", "60"]); console.log(leaf.pid); await leaf.exited;',
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
    const line = await reader.read();
    if (line.done) throw new Error("owned descendant never started");
    const pid = Number(new TextDecoder().decode(line.value).trim());
    expect(Number.isInteger(pid) && pid > 1).toBe(true);
    expect(await descendantState(pid)).not.toBe("absent");
    budget = new WorkerBudget(child, 100);
    expect(await child.exited).toBe(137);
    expect(budget.expired).toBe(true);
    const state = await descendantState(pid);
    expect(state === "absent" || state.startsWith("Z")).toBe(true);
    budget.stop(); // Already-reaped groups are safe to clean up again.
  } finally {
    reader.releaseLock();
    budget?.stop();
    budget?.close();
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, "SIGKILL");
    }
    await child.exited;
  }
});

it("manual cancellation stops an owned process and removes signal listeners", async () => {
  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  const child = Bun.spawn(["sleep", "60"], {
    detached: true,
    stdout: "ignore",
    stderr: "ignore",
  });
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
