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

function signalIsAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function commandWasTerminated(
  termination: CommandResult["termination"],
): boolean {
  return termination !== "exit";
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

function throwAfterStdinFailure(
  pid: number,
  killChild: () => void,
  executable: string,
  error: unknown,
): never {
  try {
    killProcessGroup(pid);
  } catch (cleanupError) {
    killChild();
    throw new AggregateError(
      [error, cleanupError],
      `Command stdin failed and process cleanup also failed: ${executable}`,
      { cause: cleanupError },
    );
  }
  throw error;
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array>,
  maxOutputBytes: number | undefined,
): Promise<{ text: string; truncated: boolean }> {
  if (maxOutputBytes === undefined) {
    return { text: await new Response(stream).text(), truncated: false };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;
  let truncated = false;
  let streamComplete = false;
  while (!streamComplete) {
    const chunk = await reader.read();
    streamComplete = chunk.done;
    if (chunk.done) continue;
    const value = chunk.value;
    const remaining = maxOutputBytes - retainedBytes;
    if (remaining > 0) {
      const retained = value.subarray(0, remaining);
      chunks.push(retained);
      retainedBytes += retained.byteLength;
    }
    if (value.byteLength > remaining) truncated = true;
  }
  return {
    text: Buffer.concat(chunks).toString("utf8"),
    truncated,
  };
}

export async function runCommand(
  request: CommandRequest,
): Promise<CommandResult> {
  if (
    request.maxOutputBytes !== undefined &&
    (!Number.isSafeInteger(request.maxOutputBytes) ||
      request.maxOutputBytes < 1)
  ) {
    throw new Error("maxOutputBytes must be a positive safe integer");
  }
  if (signalIsAborted(request.signal)) {
    throw new Error(`Command aborted before start: ${request.executable}`);
  }
  const subprocess = Bun.spawn([request.executable, ...request.args], {
    cwd: request.cwd,
    stdin: request.stdin === undefined ? "ignore" : "pipe",
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
  // AbortSignal does not replay an abort to a listener registered after the
  // transition. Recheck after registration and before the first await so
  // cancellation and timeout cover stdin backpressure as well as child exit.
  if (signalIsAborted(request.signal)) {
    abort();
  }
  const stdout = readBoundedText(subprocess.stdout, request.maxOutputBytes);
  const stderr = readBoundedText(subprocess.stderr, request.maxOutputBytes);
  const processSettlement = Promise.race([
    Promise.all([subprocess.exited, stdout, stderr]),
    terminationFailure.promise,
  ]);
  try {
    if (request.stdin !== undefined) {
      const stdin = subprocess.stdin;
      if (stdin === undefined || typeof stdin === "number") {
        throw new Error(
          `Command stdin pipe unavailable: ${request.executable}`,
        );
      }
      try {
        await stdin.write(request.stdin);
        await stdin.end();
      } catch (error) {
        if (!commandWasTerminated(termination)) {
          throwAfterStdinFailure(
            subprocess.pid,
            () => {
              subprocess.kill("SIGKILL");
            },
            request.executable,
            error,
          );
        }
        // Group termination closes a blocked pipe. Its write error is the
        // expected consequence of the already-recorded timeout or abort.
      }
    }
    const [exitCode, stdoutResult, stderrResult] = await processSettlement;
    return {
      exitCode,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      stdoutTruncated: stdoutResult.truncated,
      stderrTruncated: stderrResult.truncated,
      termination,
    };
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", abort);
  }
}
