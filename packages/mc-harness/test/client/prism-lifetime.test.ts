import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { it, expect } from "vitest";
import { ownPrismGame } from "#daemon/prism-lifetime.ts";
import type { LaunchSpec } from "#daemon/client-launch.ts";

it("follows the native game after Prism forwards launch and refuses to signal a reused or unrelated PID", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "prism-life-"));
  const game = Bun.spawn(["bun", "-e", "process.stdin.resume()"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "ignore",
  });
  const spec: LaunchSpec = {
    repoRoot: directory,
    bootstrapPath: path.join(directory, "bootstrap.json"),
    bootstrap: {
      socket: path.join(directory, "client.sock"),
      artifacts: directory,
      server: "mc.ts-mc.net:30000",
    },
    gameDir: directory,
    username: "XiguaJerred",
    logPath: path.join(directory, "client.log"),
  };
  const observed = Promise.withResolvers<undefined>();
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.once("data", (chunk) => {
      const request = z
        .object({ id: z.string() })
        .parse(JSON.parse(chunk.toString()));
      socket.end(
        `${JSON.stringify({ version: 1, id: request.id, ok: true, result: { pid: game.pid } })}\n`,
      );
      observed.resolve(undefined);
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(spec.bootstrap.socket, resolve);
  });
  const cleaned: boolean[] = [];
  const owned = ownPrismGame(
    spec,
    {
      pid: 9999,
      exited: Promise.resolve(0),
      exitCode: () => 0,
      kill: () => {
        throw new Error(
          "Forwarded launcher must not receive a signal after native ownership",
        );
      },
    },
    (completed) => {
      cleaned.push(completed);
      return Promise.resolve();
    },
  );
  try {
    await observed.promise;
    const deadline = performance.now() + 2000;
    while (owned.pid !== game.pid && performance.now() < deadline)
      await Bun.sleep(1);
    expect(owned.pid).toBe(game.pid);
    expect(owned.exitCode()).toBeNull();
    expect(cleaned).toEqual([]);
    await expect(owned.kill("SIGTERM")).rejects.toThrow(
      "capture-session identity differs",
    );
    expect(game.exitCode).toBeNull();
    game.kill();
    await game.exited;
    expect(await owned.exited).toBe(0);
    expect(cleaned).toEqual([true]);
  } finally {
    game.kill();
    await game.exited;
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
