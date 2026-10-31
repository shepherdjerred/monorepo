import path from "node:path";

export type InspectionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  signalCode: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimit: boolean;
};
type InspectionRunner = (
  executable: string,
  timeoutMS: number,
) => Promise<InspectionResult>;
type InspectionFailure =
  | "deadline"
  | "signal"
  | "diagnostic"
  | "exit-status"
  | "pid-shape"
  | "owner-count"
  | "output-limit"
  | "spawn";

export class MacProcessInspectionError extends Error {
  constructor(
    readonly reason: InspectionFailure,
    readonly exitCode: number | null = null,
    readonly signalCode: NodeJS.Signals | null = null,
    readonly budgetMS: number | null = null,
  ) {
    super(
      `Owned acceptance process inspection rejected: ${reason} (exit=${String(exitCode)}, signal=${signalCode ?? "none"}, budgetMs=${String(budgetMS)})`,
    );
  }
}

export function inspectionBudget(remainingMS: number) {
  if (!Number.isSafeInteger(remainingMS) || remainingMS <= 0)
    throw new MacProcessInspectionError("deadline");
  return Math.min(10_000, remainingMS);
}

export async function captureProcessTool(
  argv: string[],
  timeoutMS: number,
  input?: string,
): Promise<InspectionResult> {
  if (inspectionBudget(timeoutMS) !== timeoutMS)
    throw new MacProcessInspectionError("deadline");
  let inspection;
  try {
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "TMPDIR", "DEVELOPER_DIR", "SDKROOT"])
      if (Bun.env[key] !== undefined) env[key] = Bun.env[key];
    inspection = Bun.spawn(argv, {
      env,
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
  } catch {
    throw new MacProcessInspectionError("spawn", null, null, timeoutMS);
  }
  let timedOut = false;
  let outputLimit = false;
  const readers = [
    inspection.stdout.getReader(),
    inspection.stderr.getReader(),
  ] as const;
  const cancelReader = async (reader: (typeof readers)[number]) => {
    try {
      await reader.cancel();
    } catch {
      // A reader already closed by process teardown needs no further cleanup.
      return;
    }
  };
  const stopTool = () => {
    // The group remains ours when its leader exits with inherited pipes open.
    try {
      process.kill(-inspection.pid, "SIGKILL");
    } catch {
      if (inspection.exitCode === null) inspection.kill("SIGKILL");
    }
    for (const reader of readers) void cancelReader(reader);
  };
  const readBounded = async (reader: (typeof readers)[number]) => {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const remaining = 4096 - bytes;
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining));
        bytes += remaining;
        outputLimit = true;
        stopTool();
        break;
      }
      chunks.push(value);
      bytes += value.byteLength;
    }
    return new TextDecoder().decode(Buffer.concat(chunks, bytes));
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stopTool();
  }, timeoutMS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readBounded(readers[0]),
      readBounded(readers[1]),
      inspection.exited,
    ]);
    return {
      stdout,
      stderr,
      exitCode,
      signalCode: inspection.signalCode,
      timedOut,
      outputLimit,
    };
  } finally {
    clearTimeout(timer);
    if (inspection.exitCode === null) {
      stopTool();
      await inspection.exited;
    }
  }
}

function inspectExecutable(executable: string, timeoutMS: number) {
  return captureProcessTool(
    ["/usr/sbin/lsof", "-t", "-a", "-d", "txt", "--", executable],
    timeoutMS,
  );
}

/** A text mapping is a candidate only; retirement also requires primary-process identity. */
export async function inspectOwnedMacProcesses(
  executable: string,
  remainingMS: number,
  runInspection: InspectionRunner = inspectExecutable,
): Promise<string[]> {
  if (!path.isAbsolute(executable))
    throw new Error("Acceptance executable must be an absolute path");
  const budget = inspectionBudget(remainingMS);
  const result = await runInspection(executable, budget);
  const reject = (reason: InspectionFailure): never => {
    throw new MacProcessInspectionError(
      reason,
      result.exitCode,
      result.signalCode,
      budget,
    );
  };
  if (result.timedOut) reject("deadline");
  if (
    result.outputLimit ||
    result.stdout.length > 4096 ||
    result.stderr.length > 4096
  )
    reject("output-limit");
  if (result.signalCode !== null) reject("signal");
  if (result.stderr !== "") reject("diagnostic");
  if (result.exitCode === 1 && result.stdout === "") return [];
  if (result.exitCode !== 0) reject("exit-status");
  const lines = result.stdout.replace(/\n$/u, "").split("\n");
  if (lines.length !== 1) reject("owner-count");
  const pid = lines[0];
  return pid !== undefined &&
    /^[1-9]\d*$/u.test(pid) &&
    Number.isSafeInteger(Number(pid)) &&
    Number(pid) <= 2_147_483_647
    ? [pid]
    : reject("pid-shape");
}
