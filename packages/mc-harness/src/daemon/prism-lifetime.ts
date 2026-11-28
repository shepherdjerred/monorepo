import { lstat, appendFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { clientRequest } from "./client-socket.ts";
import type { LaunchedClient, LaunchSpec } from "./client-launch.ts";
import { createPrismMemoryMonitor } from "./prism.ts";

export type PrismLifetimeOptions = {
  prismLogPath?: string;
  prismLogOffset?: number;
  memoryPromptGraceMs?: number;
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH")
      return false;
    throw error;
  }
}

async function socketExists(socket: string): Promise<boolean> {
  try {
    const stat = await lstat(socket);
    return stat.isSocket();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** A successful CLI exit can mean Prism forwarded launch to its existing GUI. */
export function ownPrismGame(
  spec: LaunchSpec,
  launcher: LaunchedClient,
  cleanup: (completed: boolean) => Promise<void>,
  options?: PrismLifetimeOptions,
): LaunchedClient {
  const state: {
    pid: number | undefined;
    code: number | null;
    error: string | undefined;
    stopping: boolean;
  } = { pid: undefined, code: null, error: undefined, stopping: false };
  const memoryMonitor =
    options?.prismLogPath === undefined
      ? undefined
      : createPrismMemoryMonitor({
          logPath: options.prismLogPath,
          offset: options.prismLogOffset ?? 0,
          ...(options.memoryPromptGraceMs === undefined
            ? {}
            : { graceMs: options.memoryPromptGraceMs }),
        });
  const observe = async () => {
    const deadline = performance.now() + 300_000;
    while (state.pid === undefined) {
      if (state.stopping)
        throw new Error(
          "Capture stopped before its game identity was observed; diagnostics copied to artifacts",
        );
      const code = launcher.exitCode();
      if (code !== null && code !== 0) return code;
      if (performance.now() >= deadline)
        throw new Error(
          "Prism game did not expose its owned control socket; diagnostics copied to artifacts",
        );
      if (await socketExists(spec.bootstrap.socket)) {
        const status = await clientRequest(
          spec.bootstrap.socket,
          "status",
          {},
          5000,
        );
        state.pid = z
          .object({ pid: z.number().int().positive() })
          .parse(status).pid;
      } else {
        if (memoryMonitor !== undefined) await memoryMonitor.poll();
        await Bun.sleep(100);
      }
    }
    while (alive(state.pid)) await Bun.sleep(100);
    return 0;
  };
  const exited = (async () => {
    try {
      const code = await observe();
      state.code = code;
      await cleanup(code === 0);
      return code;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.code = 1;
      await appendFile(
        spec.logPath,
        `\nCapture process failed: ${String(error)}\n`,
      );
      await cleanup(false);
      return 1;
    }
  })();
  return {
    get pid() {
      return state.pid ?? launcher.pid;
    },
    exited,
    exitCode: () => state.code,
    failureReason: () => state.error,
    kill: async (signal) => {
      state.stopping = true;
      const pid = state.pid;
      if (pid === undefined) {
        await launcher.kill(signal);
        return;
      }
      if (!alive(pid)) return;
      // Verify the exact bootstrap property before a signal, including PID-reuse protection.
      if (!(await hasSession(pid, spec.bootstrapPath)))
        throw new Error(
          "Refusing to signal a process whose capture-session identity differs",
        );
      process.kill(pid, signal);
    },
  };
}

async function hasSession(pid: number, bootstrap: string): Promise<boolean> {
  const argument = `-Dstorm.client.session=${bootstrap}`;
  if (process.platform === "linux") {
    const arguments_ = await readFile(
      `/proc/${pid.toString()}/cmdline`,
      "utf8",
    );
    return arguments_.split("\0").includes(argument);
  }
  const ps = Bun.spawn(["ps", "-p", pid.toString(), "-o", "command="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const command = await new Response(ps.stdout).text();
  return (await ps.exited) === 0 && command.includes(argument);
}
