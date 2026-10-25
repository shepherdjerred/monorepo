import assert from "node:assert/strict";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type CommandOptions = {
  cwd: string;
  logs: string;
  timeoutMS: number;
  capture?: boolean;
  input?: string;
  acceptedExitCodes?: readonly number[];
};

type CommandChild = {
  pid: number;
  exited: Promise<number>;
  unref(): void;
};
type CommandSpawnOptions = {
  cwd: string;
  env: Record<string, string | undefined>;
  detached: true;
  stdin: "ignore" | Uint8Array;
  stdout: number;
  stderr: number;
};
type CommandControls = {
  retire: (pid: number) => void;
  spawn?: (argv: string[], options: CommandSpawnOptions) => CommandChild;
  clock?: () => { wallMS: number; monotonicMS: number };
};

function retireGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw error;
  }
}

/** File-backed output has no inherited-pipe EOF wait; the deadline owns actual child exit. */
export async function boundedCommandResult(
  argv: string[],
  options: CommandOptions,
  controls: CommandControls = { retire: retireGroup },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  assert.ok(Number.isSafeInteger(options.timeoutMS) && options.timeoutMS > 0);
  await mkdir(options.logs, { recursive: true, mode: 0o700 });
  const filename = path.join(options.logs, `${crypto.randomUUID()}.log`);
  const log = await open(filename, "wx", 0o600);
  const diagnosticFilename = filename + ".stderr";
  const diagnostics = await open(diagnosticFilename, "wx", 0o600);
  let child: CommandChild | undefined;
  let timedOut = false;
  const failures: unknown[] = [];
  let observedExit = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hardDeadline: ReturnType<typeof setTimeout> | undefined;
  let exitCode: number | undefined;
  const clock =
    controls.clock ??
    (() => ({ wallMS: Date.now(), monotonicMS: performance.now() }));
  const started = clock();
  let elapsedMS = 0;
  function deadlineExceeded(): boolean {
    const now = clock();
    assert.ok(Number.isFinite(now.wallMS) && Number.isFinite(now.monotonicMS));
    assert.ok(now.monotonicMS >= started.monotonicMS);
    // Wall time catches suspension; monotonic time retains a deadline across clock rollback.
    elapsedMS = Math.max(
      elapsedMS,
      now.wallMS - started.wallMS,
      now.monotonicMS - started.monotonicMS,
    );
    return elapsedMS >= options.timeoutMS;
  }
  try {
    const env: Record<string, string | undefined> = {
      ...Bun.env,
      MISE_EXEC_AUTO_INSTALL: "false",
    };
    delete env["OP_SERVICE_ACCOUNT_TOKEN"];
    child = (controls.spawn ?? Bun.spawn)(argv, {
      cwd: options.cwd,
      env,
      detached: true,
      stdin:
        options.input === undefined
          ? "ignore"
          : new TextEncoder().encode(options.input),
      stdout: log.fd,
      stderr: diagnostics.fd,
    });
    const owned = child;
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (!observedExit) controls.retire(owned.pid);
      } catch (error) {
        failures.push(error);
      }
    }, options.timeoutMS);
    const code = await Promise.race([
      child.exited.then((code) => {
        observedExit = true;
        return code;
      }),
      new Promise<never>((_, reject) => {
        hardDeadline = setTimeout(
          () =>
            reject(new Error(`Command exit deadline exceeded; ${filename}`)),
          options.timeoutMS + 2_000,
        );
      }),
    ]);
    exitCode = code;
    // Exit can win the microtask race before an overdue timer is delivered.
    if (deadlineExceeded()) timedOut = true;
    if (timedOut || !(options.acceptedExitCodes ?? [0]).includes(code))
      throw new Error(
        `${argv.slice(0, 2).join(" ")} ${timedOut ? "timed out" : `exited ${String(code)}`}; ${filename}`,
      );
  } catch (error) {
    failures.push(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (hardDeadline !== undefined) clearTimeout(hardDeadline);
    try {
      if (child && !observedExit) {
        try {
          controls.retire(child.pid);
        } finally {
          child.unref();
        }
      }
    } catch (error) {
      failures.push(error);
    } finally {
      const closed = await Promise.allSettled([
        log.close(),
        diagnostics.close(),
      ]);
      for (const result of closed)
        if (result.status === "rejected") failures.push(result.reason);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      failures
        .map((error) =>
          error instanceof Error ? error.message : String(error),
        )
        .join("; "),
    );
  assert.ok(exitCode !== undefined);
  if (!options.capture) return { stdout: "", stderr: "", exitCode };
  assert.ok(
    (await stat(filename)).size <= 8 * 1024 * 1024,
    `Captured command output exceeds its limit: ${filename}`,
  );
  assert.ok(
    (await stat(diagnosticFilename)).size <= 8 * 1024 * 1024,
    `Captured diagnostics exceed their limit: ${diagnosticFilename}`,
  );
  return {
    stdout: (await readFile(filename, "utf8")).trim(),
    stderr: (await readFile(diagnosticFilename, "utf8")).trim(),
    exitCode,
  };
}

export async function boundedCommand(
  argv: string[],
  options: CommandOptions,
): Promise<string> {
  const result = await boundedCommandResult(argv, options);
  return result.stdout;
}
