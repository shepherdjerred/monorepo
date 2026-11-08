import { mkdtemp, open, rm } from "node:fs/promises";
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
test("binary output preserves every byte and rejects collisions before spawning", async () => {
  const settings = await options(),
    output = path.join(settings.logs, "owned.bin");
  const binary = {
    ...settings,
    capture: false,
    outputFile: { path: output, maximumBytes: 4 },
  };
  await boundedCommand(
    [
      process.execPath,
      "-e",
      "await Bun.write(Bun.stdout, new Uint8Array([0,255,10,13]))",
    ],
    binary,
  );
  expect(await Bun.file(output).bytes()).toEqual(
    new Uint8Array([0, 255, 10, 13]),
  );
  await expect(
    boundedCommandResult(["must-not-spawn"], binary, {
      retire: () => {
        throw Error("Unexpected retirement");
      },
      spawn: () => {
        throw Error("Unexpected spawn");
      },
    }),
  ).rejects.toThrow("EEXIST");
});
test("diagnostic open failure closes the previously acquired output descriptor", async () => {
  let acquired: Awaited<ReturnType<typeof open>> | undefined;
  await expect(
    boundedCommandResult(["must-not-spawn"], await options(), {
      retire: () => {
        throw Error("Unexpected retirement");
      },
      open: async (...args) => {
        if (acquired) throw Error("Injected diagnostic open failure");
        acquired = await open(...args);
        return acquired;
      },
      spawn: () => {
        throw Error("Unexpected spawn");
      },
    }),
  ).rejects.toThrow("Injected diagnostic open failure");
  expect(acquired?.fd).toBe(-1);
});
test.each(["oversize", "timeout"])(
  "binary %s retires its owned writer and closes output",
  async (kind) => {
    const settings = await options(200),
      output = path.join(settings.logs, "owned.bin");
    const pids: number[] = [];
    await expect(
      boundedCommandResult(
        [
          process.execPath,
          "-e",
          kind === "oversize"
            ? "await Bun.write(Bun.stdout,new Uint8Array(65536));setInterval(()=>{},1000)"
            : "setInterval(()=>{},1000)",
        ],
        {
          ...settings,
          capture: false,
          outputFile: { path: output, maximumBytes: 8 },
        },
        {
          retire: (pid) => {
            pids.push(pid);
            process.kill(-pid, "SIGKILL");
          },
        },
      ),
    ).rejects.toThrow(kind === "oversize" ? "exceeds its limit" : "timed out");
    expect(pids).toHaveLength(1);
    expect(Bun.file(output).size).toBeLessThanOrEqual(8);
    await rm(output);
    expect(await Bun.file(output).exists()).toBe(false);
  },
);
