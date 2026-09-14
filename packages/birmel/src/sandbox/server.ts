import {
  RunCodeRequestSchema,
  RunCodeResponseSchema,
  SANDBOX_MAX_OUTPUT_BYTES,
  SANDBOX_PORT,
  SANDBOX_TIMEOUT_MS,
  SANDBOX_UIDS,
  type RunCodeRequest,
  type RunCodeResponse,
} from "./contracts.ts";
import { SANDBOX_MAX_PROCESSES } from "./process-limits.ts";
import {
  chmod,
  chown,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const availableSandboxUids = new Set<number>(SANDBOX_UIDS);
const SANDBOX_PROCESS_CLEANUP_ATTEMPTS = 50;
const SANDBOX_ROOT = "/tmp/birmel-sandbox";

function interpreterCommand(input: RunCodeRequest): string[] {
  switch (input.language) {
    case "python":
      return ["python3", "-I", "main.py"];
    case "javascript":
      return [
        "bun",
        "--preload",
        "/usr/local/share/birmel-sandbox/limit-bun-processes.ts",
        "main.js",
      ];
    case "typescript":
      return [
        "bun",
        "--preload",
        "/usr/local/share/birmel-sandbox/limit-bun-processes.ts",
        "main.ts",
      ];
  }
}

function sourceFilename(language: RunCodeRequest["language"]): string {
  switch (language) {
    case "python":
      return "main.py";
    case "javascript":
      return "main.js";
    case "typescript":
      return "main.ts";
  }
}

function sandboxCommand(input: RunCodeRequest, sandboxUid: number): string[] {
  const addressSpaceBytes =
    input.language === "python" ? 256 * 1024 * 1024 : 1024 * 1024 * 1024;
  return [
    "setsid",
    "--wait",
    "prlimit",
    `--cpu=${String(Math.ceil(SANDBOX_TIMEOUT_MS / 1000))}`,
    `--as=${String(addressSpaceBytes)}`,
    `--fsize=${String(1024 * 1024)}`,
    "--msgqueue=0",
    `--nproc=${String(
      input.language === "python" ? SANDBOX_MAX_PROCESSES : 32,
    )}`,
    "--",
    "setpriv",
    `--reuid=${String(sandboxUid)}`,
    `--regid=${String(sandboxUid)}`,
    "--clear-groups",
    "--no-new-privs",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--bounding-set=-all",
    "--seccomp-filter=/usr/local/share/birmel-persistence.seccomp",
    "--",
    ...interpreterCommand(input),
  ];
}

function acquireSandboxUid(): number | undefined {
  const candidate = availableSandboxUids.values().next();
  if (candidate.value == null) {
    return;
  }
  availableSandboxUids.delete(candidate.value);
  return candidate.value;
}

function releaseSandboxUid(sandboxUid: number): void {
  availableSandboxUids.add(sandboxUid);
}

function statusBelongsToUid(status: string, sandboxUid: number): boolean {
  const match = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/mu.exec(status);
  return match?.slice(1).map(Number).includes(sandboxUid) === true;
}

async function sandboxProcessIds(sandboxUid: number): Promise<number[]> {
  const processIds: number[] = [];
  for (const entry of await readdir("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) {
      continue;
    }
    let status: string;
    try {
      status = await readFile(`/proc/${entry.name}/status`, "utf8");
    } catch {
      continue;
    }
    if (statusBelongsToUid(status, sandboxUid)) {
      processIds.push(Number(entry.name));
    }
  }
  return processIds;
}

async function killSandboxUidProcesses(sandboxUid: number): Promise<void> {
  for (
    let attempt = 0;
    attempt < SANDBOX_PROCESS_CLEANUP_ATTEMPTS;
    attempt += 1
  ) {
    const processIds = await sandboxProcessIds(sandboxUid);
    if (processIds.length === 0) {
      return;
    }
    for (const processId of processIds) {
      try {
        process.kill(processId, "SIGKILL");
      } catch {
        // The process exited between the /proc scan and the signal.
      }
    }
    await Bun.sleep(10);
  }
  const survivors = await sandboxProcessIds(sandboxUid);
  if (survivors.length > 0) {
    throw new Error(
      `Sandbox process cleanup failed for uid ${String(sandboxUid)}`,
    );
  }
}

async function ignoreCleanupFailure(cleanup: Promise<void>): Promise<void> {
  try {
    await cleanup;
  } catch {
    // The awaited execution cleanup reports the same failure to the request.
  }
}

function killProcessGroup(processId: number): void {
  try {
    process.kill(-processId, "SIGKILL");
  } catch {
    // The group has already exited.
    return;
  }
}

async function readBoundedOutput(
  stream: ReadableStream<Uint8Array>,
  budget: { remaining: number; truncated: boolean },
  stop: () => void,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (budget.remaining === 0) {
        budget.truncated = true;
        stop();
        break;
      }
      const accepted = result.value.subarray(0, budget.remaining);
      chunks.push(accepted);
      budget.remaining -= accepted.byteLength;
      if (accepted.byteLength < result.value.byteLength) {
        budget.truncated = true;
        stop();
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => null);
    reader.releaseLock();
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

export async function executeSandboxedCode(
  input: RunCodeRequest,
  sandboxUid: number,
): Promise<RunCodeResponse> {
  const startedAt = Date.now();
  const workDirectory = await mkdtemp(path.join(SANDBOX_ROOT, "run-"));
  const controller = new AbortController();
  let stopSandbox: (() => void) | undefined;
  const timeout = setTimeout(() => {
    controller.abort(new Error("Code execution timed out"));
    stopSandbox?.();
  }, SANDBOX_TIMEOUT_MS);

  try {
    const sourcePath = path.join(workDirectory, sourceFilename(input.language));
    await writeFile(sourcePath, input.source, { mode: 0o600 });
    await chown(workDirectory, sandboxUid, sandboxUid);
    await chown(sourcePath, sandboxUid, sandboxUid);
    const sandboxProcess = Bun.spawn({
      cmd: sandboxCommand(input, sandboxUid),
      cwd: workDirectory,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: controller.signal,
      env: {
        HOME: workDirectory,
        PATH: "/usr/local/bin:/usr/bin:/bin",
        BUN_CONFIG_NO_INSTALL: "1",
        TMPDIR: workDirectory,
      },
    });
    await sandboxProcess.stdin.write(input.stdin ?? "");
    await sandboxProcess.stdin.end();

    const budget = {
      remaining: SANDBOX_MAX_OUTPUT_BYTES,
      truncated: false,
    };
    let uidCleanup: Promise<void> | undefined;
    const cleanUid = () => {
      uidCleanup ??= killSandboxUidProcesses(sandboxUid);
      return uidCleanup;
    };
    const stop = () => {
      killProcessGroup(sandboxProcess.pid);
      sandboxProcess.kill();
      void ignoreCleanupFailure(cleanUid());
    };
    stopSandbox = stop;
    const exitCodeWithCleanup = (async () => {
      let exitCode: number;
      try {
        exitCode = await sandboxProcess.exited;
      } catch {
        exitCode = -1;
      }
      killProcessGroup(sandboxProcess.pid);
      await cleanUid();
      return exitCode;
    })();
    const [stdout, stderr, exitCode] = await Promise.all([
      readBoundedOutput(sandboxProcess.stdout, budget, stop),
      readBoundedOutput(sandboxProcess.stderr, budget, stop),
      exitCodeWithCleanup,
    ]);
    const timedOut = controller.signal.aborted;
    const durationMs = Date.now() - startedAt;
    return RunCodeResponseSchema.parse({
      success: exitCode === 0 && !timedOut && !budget.truncated,
      message: timedOut
        ? `Code execution timed out after ${String(SANDBOX_TIMEOUT_MS)}ms`
        : budget.truncated
          ? `Code output exceeded ${String(SANDBOX_MAX_OUTPUT_BYTES)} bytes`
          : exitCode === 0
            ? "Code executed successfully"
            : `Code exited with status ${String(exitCode)}`,
      data: {
        stdout,
        stderr,
        exitCode,
        timedOut,
        truncated: budget.truncated,
        durationMs,
      },
    });
  } finally {
    clearTimeout(timeout);
    await killSandboxUidProcesses(sandboxUid);
    await rm(workDirectory, { recursive: true, force: true });
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ live: true });
  }
  if (request.method !== "POST" || url.pathname !== "/run") {
    return new Response("Not found", { status: 404 });
  }
  const parsed = RunCodeRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { success: false, message: "Invalid sandbox request" },
      { status: 400 },
    );
  }

  const sandboxUid = acquireSandboxUid();
  if (sandboxUid == null) {
    return Response.json(
      { success: false, message: "Sandbox is busy" },
      { status: 429 },
    );
  }

  let safeToReuseUid = false;
  try {
    const result = await executeSandboxedCode(parsed.data, sandboxUid);
    safeToReuseUid = true;
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sandbox failed";
    return Response.json({ success: false, message }, { status: 500 });
  } finally {
    if (safeToReuseUid) {
      releaseSandboxUid(sandboxUid);
    }
  }
}

if (import.meta.main) {
  await mkdir(SANDBOX_ROOT, { recursive: true });
  await chmod(SANDBOX_ROOT, 0o711);
  await chmod("/dev/shm", 0o555);
  await chmod("/dev/mqueue", 0o555);
  Bun.serve({
    hostname: "127.0.0.1",
    port: SANDBOX_PORT,
    fetch: handleRequest,
  });
}
