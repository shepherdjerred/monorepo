import { lstat, appendFile } from "node:fs/promises";
import { z } from "zod";
import { clientRequest } from "./client-socket.ts";
import type { LaunchedClient, LaunchSpec } from "./client-launch.ts";

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
): LaunchedClient {
  const state: {
    pid: number | undefined;
    code: number | null;
    stopping: boolean;
  } = { pid: undefined, code: null, stopping: false };
  const observe = async () => {
    const deadline = performance.now() + 300_000;
    while (state.pid === undefined) {
      if (state.stopping)
        throw new Error(
          "Capture stopped before its game identity was observed; retained instance for inspection",
        );
      const code = launcher.exitCode();
      if (code !== null && code !== 0) return code;
      if (performance.now() >= deadline)
        throw new Error(
          "Prism game did not expose its owned control socket; retained instance for inspection",
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
      } else await Bun.sleep(100);
    }
    while (alive(state.pid)) await Bun.sleep(100);
    return 0;
  };
  const exited = (async () => {
    try {
      const code = await observe();
      state.code = code;
      await cleanup(true);
      return code;
    } catch (error) {
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
    kill: async (signal) => {
      state.stopping = true;
      const pid = state.pid;
      if (pid === undefined) {
        await launcher.kill(signal);
        return;
      }
      if (!alive(pid)) return;
      // Verify the exact bootstrap property before a signal, including PID-reuse protection.
      const ps = Bun.spawn(["ps", "-p", pid.toString(), "-o", "command="], {
        stdout: "pipe",
        stderr: "ignore",
      });
      const command = await new Response(ps.stdout).text();
      const code = await ps.exited;
      if (
        code !== 0 ||
        !command.includes(`-Dstorm.client.session=${spec.bootstrapPath}`)
      )
        throw new Error(
          "Refusing to signal a process whose capture-session identity differs",
        );
      process.kill(pid, signal);
    },
  };
}
