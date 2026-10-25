import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
import { boundedCommand, boundedCommandResult } from "./bounded-command.ts";
const directories: string[] = [];
test.each([
  { name: "late timer delivery", wallMS: 1_000, monotonicMS: 1_000 },
  { name: "suspended monotonic clock", wallMS: 1_000, monotonicMS: 50 },
  { name: "wall clock rollback", wallMS: -1_000, monotonicMS: 1_000 },
])(
  "rejects a zero exit after its deadline with $name without signalling an exited child",
  async ({ wallMS, monotonicMS }) => {
    let completed = false;
    const retired: number[] = [];
    await expect(
      boundedCommandResult(["injected-owned-child"], await options(100), {
        retire: (pid) => {
          retired.push(pid);
        },
        clock: () =>
          completed ? { wallMS, monotonicMS } : { wallMS: 0, monotonicMS: 0 },
        spawn: () => ({
          pid: 123,
          unref() {},
          exited: Promise.resolve().then(() => {
            completed = true;
            return 0;
          }),
        }),
      }),
    ).rejects.toThrow("timed out");
    expect(retired).toEqual([]);
  },
);
test("accepts an acknowledged injected child only while both clocks remain within budget", async () => {
  let completed = false;
  await expect(
    boundedCommandResult(["injected-owned-child"], await options(100), {
      retire: () => {
        throw new Error("An acknowledged child cannot be signalled");
      },
      clock: () =>
        completed
          ? { wallMS: 50, monotonicMS: 50 }
          : { wallMS: 0, monotonicMS: 0 },
      spawn: () => ({
        pid: 123,
        unref() {},
        exited: Promise.resolve().then(() => {
          completed = true;
          return 0;
        }),
      }),
    }),
  ).resolves.toEqual({ stdout: "", stderr: "", exitCode: 0 });
});
test("a signal exit acknowledgement never grants another group signal", async () => {
  const retired: number[] = [];
  await expect(
    boundedCommandResult(["/bin/sh", "-c", "kill -TERM $$"], await options(), {
      retire: (pid) => {
        retired.push(pid);
      },
    }),
  ).rejects.toThrow("exited");
  expect(retired).toEqual([]);
});
test("structured stdout remains separate from successful tool diagnostics", async () => {
  const argv = [
    "/bin/sh",
    "-c",
    "printf 8044490B-B760-4D0E-B266-04E1425F2D5F; printf 'No runtime specified' >&2",
  ];
  await expect(boundedCommandResult(argv, await options())).resolves.toEqual({
    stdout: "8044490B-B760-4D0E-B266-04E1425F2D5F",
    stderr: "No runtime specified",
    exitCode: 0,
  });
  await expect(boundedCommand(argv, await options())).resolves.toBe(
    "8044490B-B760-4D0E-B266-04E1425F2D5F",
  );
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
async function options(timeoutMS = 1_000) {
  const logs = await mkdtemp(path.join(tmpdir(), "facet-command-control-"));
  directories.push(logs);
  return { cwd: logs, logs, timeoutMS, capture: true };
}
test("requires actual child success and retains file-backed output", async () => {
  await expect(
    boundedCommand(["/bin/sh", "-c", "printf ready"], await options()),
  ).resolves.toBe("ready");
  await expect(
    boundedCommand(["/bin/sh", "-c", "exit 3"], await options()),
  ).rejects.toThrow("exited 3");
});
test("an inherited output descriptor cannot hold the command past actual leader exit", async () => {
  const before = Date.now();
  await expect(
    boundedCommand(
      ["/bin/sh", "-c", "sleep 0.5 & printf exited"],
      await options(100),
    ),
  ).resolves.toBe("exited");
  expect(Date.now() - before).toBeLessThan(2_500);
});
test("startup or command stalls have a deadline including forced owned-group exit", async () => {
  const before = Date.now();
  await expect(
    boundedCommand(["/bin/sh", "-c", "exec sleep 30"], await options(100)),
  ).rejects.toThrow("timed out");
  expect(Date.now() - before).toBeLessThan(2_500);
});
