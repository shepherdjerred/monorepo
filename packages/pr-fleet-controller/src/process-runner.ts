import { z } from "zod";
import type { CommandRequest, CommandResult } from "./ports.ts";

const SystemErrorSchema = z.object({ code: z.string() });

function errorHasCode(error: unknown, code: string): boolean {
  const parsed = SystemErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === code;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Non-Error command termination failure", { cause: error });
}

function killProcessGroup(pid: number): void {
  if (process.platform === "win32") {
    throw new Error("PR fleet process-group termination requires POSIX");
  }
  try {
    // A detached Bun subprocess leads a new POSIX process group. A negative
    // PID targets the complete group, including grandchildren.
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!errorHasCode(error, "ESRCH")) {
      throw normalizeError(error);
    }
  }
}

export async function runCommand(
  request: CommandRequest,
): Promise<CommandResult> {
  if (request.signal?.aborted === true) {
    throw new Error(`Command aborted before start: ${request.executable}`);
  }
  const subprocess = Bun.spawn([request.executable, ...request.args], {
    cwd: request.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: request.env ?? Bun.env,
    detached: true,
  });
  let termination: CommandResult["termination"] = "exit";
  const terminationFailure = Promise.withResolvers<never>();
  const terminate = (reason: "timeout" | "abort"): void => {
    if (termination !== "exit") {
      return;
    }
    termination = reason;
    try {
      killProcessGroup(subprocess.pid);
    } catch (error) {
      // Keep the direct-child safety net if group signaling itself fails.
      // The captured error rejects the command after the child is killed.
      subprocess.kill("SIGKILL");
      terminationFailure.reject(normalizeError(error));
    }
  };
  const timer = setTimeout(() => {
    terminate("timeout");
  }, request.timeoutMs);
  const abort = (): void => {
    terminate("abort");
  };
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    const [exitCode, stdout, stderr] = await Promise.race([
      Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]),
      terminationFailure.promise,
    ]);
    return { exitCode, stdout, stderr, termination };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}
