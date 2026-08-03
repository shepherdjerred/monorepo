import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexProvider } from "@shepherdjerred/code-review";
import { CommandFleetEnvironment } from "@shepherdjerred/pr-fleet-controller/src/environment.ts";

describe("command process-group termination", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "pr-fleet-process-group-"));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const environment = new CommandFleetEnvironment({
    repo: "shepherdjerred/monorepo",
    checkout: "/tmp/repo",
    worktreeRoot: "/tmp/worktrees",
    provider: codexProvider,
  });

  async function runDescendant(output: string, signal?: AbortSignal) {
    const bun = Bun.which("bun");
    if (bun === null) {
      throw new Error("bun is required for process-group tests");
    }
    const script = `
      const output = Bun.argv.at(-1);
      if (output === undefined) throw new Error("missing output path");
      const child = Bun.spawn([
        "sh",
        "-c",
        'sleep 0.25; printf survived > "$1"',
        "child",
        output,
      ]);
      await child.exited;
    `;
    return environment.runLocalCommand({
      executable: bun,
      args: ["-e", script, output],
      cwd: directory,
      timeoutMs: signal === undefined ? 50 : 5000,
      signal,
    });
  }

  test("a timeout kills grandchildren before they can outlive the command", async () => {
    const output = path.join(directory, "timeout-survivor.txt");
    const result = await runDescendant(output);
    expect(result.exitCode).not.toBe(0);
    await Bun.sleep(400);
    expect(await Bun.file(output).exists()).toBe(false);
  });

  test("an abort kills the same complete process group", async () => {
    const output = path.join(directory, "abort-survivor.txt");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 50);
    try {
      const result = await runDescendant(output, controller.signal);
      expect(result.exitCode).not.toBe(0);
    } finally {
      clearTimeout(timer);
    }
    await Bun.sleep(400);
    expect(await Bun.file(output).exists()).toBe(false);
  });
});
