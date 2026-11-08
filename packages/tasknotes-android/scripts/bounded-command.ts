import assert from "node:assert/strict";
import { mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";

type ClockSample = { wallMS: number; monotonicMS: number };
type Clock = () => ClockSample;
const currentClock: Clock = () => ({
  wallMS: Date.now(),
  monotonicMS: performance.now(),
});

/** A single absolute budget: suspension and delayed timers cannot turn an overdue exit into success. */
export class AcceptanceDeadline {
  private readonly started: ClockSample;
  private elapsedMS = 0;
  constructor(
    readonly timeoutMS: number,
    private readonly clock: Clock = currentClock,
  ) {
    assert.ok(
      Number.isSafeInteger(timeoutMS) && timeoutMS > 0,
      "A positive integer deadline is required.",
    );
    this.started = clock();
    assert.ok(
      Number.isFinite(this.started.wallMS) &&
        Number.isFinite(this.started.monotonicMS),
    );
  }
  sample() {
    const now = this.clock();
    assert.ok(Number.isFinite(now.wallMS) && Number.isFinite(now.monotonicMS));
    assert.ok(now.monotonicMS >= this.started.monotonicMS);
    const wallElapsedMS = now.wallMS - this.started.wallMS;
    const monotonicElapsedMS = now.monotonicMS - this.started.monotonicMS;
    this.elapsedMS = Math.max(
      this.elapsedMS,
      wallElapsedMS,
      monotonicElapsedMS,
    );
    return { wallElapsedMS, monotonicElapsedMS, elapsedMS: this.elapsedMS };
  }
  remainingMS(): number {
    return Math.max(0, this.timeoutMS - this.sample().elapsedMS);
  }
  assertWithin(): void {
    assert.ok(
      this.remainingMS() > 0,
      `Acceptance deadline exceeded (${this.timeoutMS} ms).`,
    );
  }
}

type CommandChild = {
  pid: number;
  exited: Promise<number>;
  kill(signal: "SIGKILL"): void;
  unref(): void;
};
type SpawnOptions = {
  cwd: string;
  env: Record<string, string | undefined>;
  stdin: "ignore" | Uint8Array;
  stdout: number;
  stderr: number;
};
type Controls = {
  clock?: Clock;
  spawn?: (argv: string[], options: SpawnOptions) => CommandChild;
};
type CommandOptions = {
  cwd: string;
  logs: string;
  timeoutMS: number;
  env?: Record<string, string | undefined>;
  input?: string;
};

/** File-backed streams await the owned child, never a descendant's inherited output pipe. */
export async function boundedCommand(
  argv: string[],
  options: CommandOptions,
  controls: Controls = {},
) {
  const deadline = new AcceptanceDeadline(options.timeoutMS, controls.clock);
  await mkdir(options.logs, { recursive: true });
  const logPath = join(options.logs, `${crypto.randomUUID()}.stdout`);
  const output = await open(logPath, "wx", 0o600);
  const errors = await open(logPath + ".stderr", "wx", 0o600);
  let child: CommandChild | undefined;
  let acknowledged = false;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hardDeadline: ReturnType<typeof setTimeout> | undefined;
  let exitCode: number | undefined;
  const failures: unknown[] = [];
  try {
    deadline.assertWithin();
    const env = { ...process.env, ...options.env };
    delete env["OP_SERVICE_ACCOUNT_TOKEN"];
    child = (controls.spawn ?? Bun.spawn)(argv, {
      cwd: options.cwd,
      env,
      stdin:
        options.input === undefined
          ? "ignore"
          : new TextEncoder().encode(options.input),
      stdout: output.fd,
      stderr: errors.fd,
    });
    const owned = child;
    timer = setTimeout(() => {
      timedOut = true;
      try {
        if (!acknowledged) owned.kill("SIGKILL");
      } catch (error) {
        failures.push(error);
      }
    }, deadline.remainingMS());
    exitCode = await Promise.race([
      child.exited.then((code) => {
        acknowledged = true;
        return code;
      }),
      new Promise<never>((_, reject) => {
        hardDeadline = setTimeout(
          () =>
            reject(
              new Error(`Owned command exit deadline exceeded; ${logPath}`),
            ),
          deadline.remainingMS() + 2_000,
        );
      }),
    ]);
    // This check is independent of timer delivery and covers a suspended monotonic clock.
    if (deadline.remainingMS() === 0) timedOut = true;
    if (timedOut || exitCode !== 0)
      throw new Error(
        `Bounded command ${timedOut ? "timed out" : `exited ${exitCode}`}; ${logPath}`,
      );
  } catch (error) {
    failures.push(error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (hardDeadline !== undefined) clearTimeout(hardDeadline);
    try {
      if (child && !acknowledged) {
        try {
          child.kill("SIGKILL");
        } finally {
          child.unref();
        }
      }
    } catch (error) {
      failures.push(error);
    }
    const closed = await Promise.allSettled([output.close(), errors.close()]);
    for (const result of closed)
      if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      failures
        .map((error) =>
          error instanceof Error ? error.message : String(error),
        )
        .join("; "),
    );
  assert.ok(child !== undefined && exitCode !== undefined);
  return {
    pid: child.pid,
    exitCode,
    timedOut,
    ...deadline.sample(),
    stdout: await readFile(logPath),
    stderr: await readFile(logPath + ".stderr", "utf8"),
    stdoutPath: logPath,
    stderrPath: logPath + ".stderr",
  };
}
