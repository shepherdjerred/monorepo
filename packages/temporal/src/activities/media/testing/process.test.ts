import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { replayWorkflowFile } from "./process.ts";
import {
  closeMovieRoleFixture,
  closeMovieRoleFixtureSequential,
} from "./role-worker.ts";

test("replay transport drains both child streams and retains a nonzero exit", async () => {
  const resolved = Bun.spawnSync(["mise", "which", "node"], {
    stdout: "pipe",
    stderr: "inherit",
  });
  expect(resolved.exitCode).toBe(0);
  const node = resolved.stdout.toString().trim();
  const directory = await mkdtemp(
    path.join(tmpdir(), "media-replay-transport-"),
  );
  try {
    const script = path.join(directory, "replay.mjs");
    await Bun.write(
      script,
      String.raw`
import { readFile } from "node:fs/promises";
import { once } from "node:events";
if (process.argv[2] !== "replay") throw new Error("Unexpected command");
const exitCode = JSON.parse(await readFile(process.argv[3], "utf8"));
if (!process.stdout.write("x".repeat(1024 * 1024))) await once(process.stdout, "drain");
if (!process.stderr.write("synthetic replay failure\\n".repeat(65536))) await once(process.stderr, "drain");
process.exitCode = exitCode;
`,
    );
    const filename = path.join(directory, "history.json");
    const input = {
      node,
      script,
      filename,
      childEnvironment: { PATH: "/usr/bin:/bin" },
    };
    await Bun.write(filename, "0");
    await expect(replayWorkflowFile(input)).resolves.toBeUndefined();
    await Bun.write(filename, "7");
    await expect(replayWorkflowFile(input)).rejects.toThrow(
      "synthetic replay failure",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(
  (["paired", "sequential"] as const).flatMap((mode) =>
    [false, true].map((failed) => ({ mode, failed })),
  ),
)(
  "$mode role cleanup retains its failure-order boundary: $failed",
  async ({ mode, failed }) => {
    const directory = await mkdtemp(path.join(tmpdir(), "media-role-cleanup-"));
    const calls: string[] = [];
    const failure = new Error("synthetic Activity drainage failure");
    const running = Promise.resolve().then(() => {
      calls.push("drained");
      if (failed) throw failure;
    });
    const input = {
      workers: [
        {
          shutdown: () => {
            calls.push("shutdown");
          },
        },
      ],
      running: [running],
      workflow: {
        kill: () => {
          calls.push("stop-node");
        },
        get exited() {
          calls.push("node-exited");
          return Promise.resolve(0);
        },
      },
      fixture: {
        close: async () => {
          calls.push("close-fixture");
        },
      },
      environment: {
        teardown: async () => {
          calls.push("teardown");
        },
      },
      directory,
    };
    const result =
      mode === "paired"
        ? closeMovieRoleFixture(input)
        : closeMovieRoleFixtureSequential({
            ...input,
            stopActivities: async () => {
              for (const worker of input.workers) worker.shutdown();
              await Promise.all(input.running);
            },
          });
    if (failed) await expect(result).rejects.toBe(failure);
    else await expect(result).resolves.toBeUndefined();
    expect(calls).toEqual([
      "shutdown",
      "drained",
      ...(mode === "sequential" && failed ? [] : ["stop-node", "node-exited"]),
      "close-fixture",
      "teardown",
    ]);
    await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  },
);
