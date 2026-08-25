import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  maintenanceLastSuccessTimestampSeconds,
  maintenanceRunsTotal,
  turboCacheCleanupEntriesTotal,
} from "#observability/metrics.ts";
import { log } from "#observability/log.ts";

const KOMETA_CONFIG_PATH = "/etc/kometa/config.yml";
const MAINTENANCE_WORKDIR = "/tmp";
const HEARTBEAT_INTERVAL_MS = 15_000;
const OUTPUT_TAIL_LINES = 20;
const OUTPUT_TAIL_CHARS = 8192;
const INHERITED_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "NO_COLOR",
  "PATH",
  "SSL_CERT_FILE",
  "TMPDIR",
] as const;
const CANCELLATION_GRACE_PERIOD_MS = 1000;
export const TURBO_CACHE_CLEAN_ACTIVITY = "turbo-cache-clean";
export const TURBO_CACHE_CLEAN_URL =
  "http://turbo-cache-turbo-cache-service.turbo-cache.svc.cluster.local:3000/v8/clean";
const TurboCacheCleanResponseSchema = z.object({
  deleted: z.number().int().nonnegative(),
  scanned: z.number().int().nonnegative(),
});

export type TurboCacheCleanResult = z.infer<
  typeof TurboCacheCleanResponseSchema
>;
export type MaintenanceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type MaintenanceKind =
  | "kometa"
  | "buildkite-bun-cache-gc"
  | "buildkite-uv-cache-prune"
  | "buildkite-trivy-db-refresh";

/**
 * Label attached to every maintenance subprocess for logs and error messages.
 * `MaintenanceKind` values also key the maintenance metrics via
 * {@link executeMaintenance}; the extra members label activities that build
 * their commands directly (and own their own reporting) without widening the
 * exhaustive `buildMaintenanceCommand` switch.
 */
export type MaintenanceSubprocessKind = MaintenanceKind | "main-vuln-scan";

export type MaintenanceCommand = {
  kind: MaintenanceSubprocessKind;
  command: readonly string[];
  cwd: string;
  env: Record<string, string>;
  secretValues: readonly string[];
};

export type MaintenanceCommandHooks = {
  heartbeat: (payload: Record<string, unknown>) => void;
  cancellationSignal?: AbortSignal;
  onCancellation: () => void;
  heartbeatIntervalMs?: number;
};

export type MaintenanceCommandRunner = (
  command: MaintenanceCommand,
  hooks: MaintenanceCommandHooks,
) => Promise<number>;

function requiredEnvironment(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for Temporal maintenance`);
  }
  return value;
}

async function requiredSecretFile(name: string): Promise<string> {
  const path = requiredEnvironment(name);
  const secretFile = Bun.file(path);
  const secretText = await secretFile.text();
  const value = secretText.trim();
  if (value === "") {
    throw new Error(`${name} points to an empty secret file`);
  }
  return value;
}

export function maintenanceActivityHooks(): MaintenanceCommandHooks {
  const context = Context.current();

  const hooks: MaintenanceCommandHooks = {
    heartbeat: (payload) => {
      context.heartbeat(payload);
    },
    onCancellation: () => {
      // The subprocess runner owns cancellation termination.
    },
  };
  hooks.cancellationSignal = context.cancellationSignal;
  return hooks;
}

export function maintenanceCommandEnvironment(
  overrides: Record<string, string>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of INHERITED_ENVIRONMENT_KEYS) {
    const value = Bun.env[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  Object.assign(environment, overrides);
  return environment;
}

export async function buildMaintenanceCommand(
  kind: MaintenanceKind,
): Promise<MaintenanceCommand> {
  switch (kind) {
    case "kometa": {
      const plexToken = await requiredSecretFile("KOMETA_PLEXTOKEN_FILE");
      const tmdbApiKey = await requiredSecretFile("KOMETA_TMDBAPIKEY_FILE");
      return {
        kind,
        command: ["kometa", "--config", KOMETA_CONFIG_PATH, "--run"],
        cwd: MAINTENANCE_WORKDIR,
        env: maintenanceCommandEnvironment({
          KOMETA_PLEXTOKEN: plexToken,
          KOMETA_TMDBAPIKEY: tmdbApiKey,
          KOMETA_READ_ONLY_CONFIG: "true",
          TZ: "America/Los_Angeles",
        }),
        secretValues: [plexToken, tmdbApiKey],
      };
    }
    case "buildkite-bun-cache-gc":
      return {
        kind,
        command: ["bash", "/buildkite/maintenance/bun-cache-gc.sh"],
        cwd: MAINTENANCE_WORKDIR,
        env: maintenanceCommandEnvironment({
          BUN_INSTALL_CACHE_DIR: "/buildkite/bun-cache/data",
          BUN_CACHE_LOCK_FILE: "/buildkite/bun-cache-control/.gc.lock",
          BUN_CACHE_GC_THRESHOLD_PERCENT: "60",
        }),
        secretValues: [],
      };
    case "buildkite-uv-cache-prune":
      return {
        kind,
        command: ["uv", "cache", "prune", "--ci"],
        cwd: MAINTENANCE_WORKDIR,
        env: maintenanceCommandEnvironment({
          UV_CACHE_DIR: "/buildkite/uv-cache",
        }),
        secretValues: [],
      };
    case "buildkite-trivy-db-refresh":
      return {
        kind,
        command: [
          "trivy",
          "image",
          "--download-db-only",
          "--cache-dir",
          "/buildkite/trivy-db",
        ],
        cwd: MAINTENANCE_WORKDIR,
        env: maintenanceCommandEnvironment({}),
        secretValues: [],
      };
  }
}

function redact(text: string, secretValues: readonly string[]): string {
  return secretValues.reduce(
    (redacted, secret) =>
      secret === "" ? redacted : redacted.replaceAll(secret, "<redacted>"),
    text,
  );
}

function appendOutputTail(tail: string[], line: string): void {
  tail.push(line);
  while (tail.length > OUTPUT_TAIL_LINES) {
    tail.shift();
  }
  while (tail.join("\n").length > OUTPUT_TAIL_CHARS) {
    tail.shift();
  }
}

/**
 * How a subprocess stream is consumed:
 *
 * - `log` — every line is redacted and streamed to the worker logs, and only a
 *   bounded tail is retained for error messages. This is the right mode for
 *   long-running maintenance jobs whose output is operational noise.
 * - `capture` — the redacted output is retained in full and returned to the
 *   caller (nothing is streamed to the logs line-by-line, which would flood
 *   Loki with a machine-readable payload). This is the mode for commands whose
 *   stdout IS the result, e.g. a `--format json` scanner.
 */
type StreamMode = "log" | "capture";

type StreamOutcome = {
  tail: string;
  /** Complete redacted output; empty string in `log` mode. */
  captured: string;
};

async function streamMaintenanceOutput(
  stream: ReadableStream<Uint8Array>,
  streamName: "stdout" | "stderr",
  command: MaintenanceCommand,
  mode: StreamMode,
): Promise<StreamOutcome> {
  const decoder = new TextDecoder();
  const tail: string[] = [];
  const captured: string[] = [];
  const consumeLine = (line: string): void => {
    const redacted = redact(line, command.secretValues);
    appendOutputTail(tail, redacted);
    if (mode === "capture") {
      captured.push(redacted);
      return;
    }
    log("info", "Maintenance subprocess output", {
      maintenanceKind: command.kind,
      stream: streamName,
      line: redacted,
    });
  };
  let pending = "";
  for await (const value of stream) {
    pending += decoder.decode(value, { stream: true });
    const lastNewline = pending.lastIndexOf("\n");
    if (lastNewline === -1) {
      continue;
    }
    const completeLines = pending.slice(0, lastNewline).split("\n");
    pending = pending.slice(lastNewline + 1);
    for (const line of completeLines) {
      consumeLine(line.replace(/\r$/, ""));
    }
  }
  pending += decoder.decode();
  if (pending !== "") {
    consumeLine(pending);
  }
  return { tail: tail.join("\n"), captured: captured.join("\n") };
}

type MaintenanceSubprocessOutcome = {
  exitCode: number;
  stdout: StreamOutcome;
  stderr: StreamOutcome;
};

/**
 * Shared subprocess core: heartbeats, process-group cancellation
 * (SIGTERM → SIGKILL), and redacted output handling live here exactly once.
 * Callers decide what a non-zero exit means; this function only reports it.
 */
async function runMaintenanceSubprocess(
  command: MaintenanceCommand,
  hooks: MaintenanceCommandHooks,
  stdoutMode: StreamMode,
): Promise<MaintenanceSubprocessOutcome> {
  const childEnv = command.env;
  const subprocess = Bun.spawn([...command.command], {
    cwd: command.cwd,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const startedAt = Date.now();
  const heartbeatTimer = setInterval(() => {
    hooks.heartbeat({
      kind: command.kind,
      elapsedMs: Date.now() - startedAt,
    });
  }, hooks.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
  const signalProcessGroup = (signal: "SIGKILL" | "SIGTERM"): void => {
    try {
      globalThis.process.kill(-subprocess.pid, signal);
    } catch {
      subprocess.kill(signal);
    }
  };
  const abort = (): void => {
    hooks.onCancellation();
    signalProcessGroup("SIGTERM");
    cancellationTimer = setTimeout(() => {
      signalProcessGroup("SIGKILL");
    }, CANCELLATION_GRACE_PERIOD_MS);
  };
  hooks.cancellationSignal?.addEventListener("abort", abort, { once: true });
  if (hooks.cancellationSignal?.aborted === true) {
    abort();
  }

  let result: [StreamOutcome, StreamOutcome, number] | undefined;
  try {
    const completion = Promise.all([
      streamMaintenanceOutput(subprocess.stdout, "stdout", command, stdoutMode),
      streamMaintenanceOutput(subprocess.stderr, "stderr", command, "log"),
      subprocess.exited,
    ]);
    result = await completion;
  } finally {
    if (cancellationTimer !== undefined) {
      clearTimeout(cancellationTimer);
    }
    clearInterval(heartbeatTimer);
    hooks.cancellationSignal?.removeEventListener("abort", abort);
  }

  if (hooks.cancellationSignal?.aborted === true) {
    hooks.cancellationSignal.throwIfAborted();
  }

  const [stdout, stderr, exitCode] = result;
  return { exitCode, stdout, stderr };
}

function throwOnMaintenanceExit(
  command: MaintenanceCommand,
  outcome: MaintenanceSubprocessOutcome,
): void {
  const detail = [outcome.stdout.tail, outcome.stderr.tail]
    .filter((output) => output !== "")
    .join("\n");
  throw new Error(
    `${command.kind} command exited ${String(outcome.exitCode)}${detail === "" ? "" : `: ${detail}`}`,
  );
}

export const spawnMaintenanceCommand: MaintenanceCommandRunner = async (
  command,
  hooks,
) => {
  const outcome = await runMaintenanceSubprocess(command, hooks, "log");
  if (outcome.exitCode !== 0) {
    throwOnMaintenanceExit(command, outcome);
  }
  return outcome.exitCode;
};

export type MaintenanceCaptureResult = {
  exitCode: number;
  /** Complete redacted stdout — the command's machine-readable result. */
  stdout: string;
};

/**
 * Variant of {@link spawnMaintenanceCommand} for commands whose stdout is the
 * result (e.g. `--format json` scanners): stdout is captured in full and
 * returned instead of being streamed to the logs, while stderr keeps the
 * ordinary log-and-tail behavior. Heartbeats, cancellation, and redaction are
 * the same shared implementation — do not fork this into a bare `Bun.spawn`.
 *
 * `acceptedExitCodes` exists for scanners that reserve a non-zero exit for
 * "findings present" (e.g. lychee exits 2 when links are broken); every other
 * exit still fails fast with the bounded output tails.
 */
export async function spawnMaintenanceCommandCapturingStdout(
  command: MaintenanceCommand,
  hooks: MaintenanceCommandHooks,
  options: { acceptedExitCodes?: readonly number[] } = {},
): Promise<MaintenanceCaptureResult> {
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  const outcome = await runMaintenanceSubprocess(command, hooks, "capture");
  if (!acceptedExitCodes.includes(outcome.exitCode)) {
    throwOnMaintenanceExit(command, outcome);
  }
  return { exitCode: outcome.exitCode, stdout: outcome.stdout.captured };
}

export async function executeMaintenance(
  kind: MaintenanceKind,
  runner: MaintenanceCommandRunner = spawnMaintenanceCommand,
  hooks: MaintenanceCommandHooks = maintenanceActivityHooks(),
): Promise<void> {
  const command = await buildMaintenanceCommand(kind);
  try {
    const exitCode = await runner(command, hooks);
    if (exitCode !== 0) {
      throw new Error(`${kind} command exited ${String(exitCode)}`);
    }
    maintenanceLastSuccessTimestampSeconds.set(
      { maintenance_job: kind },
      Date.now() / 1000,
    );
    maintenanceRunsTotal.inc({
      maintenance_job: kind,
      outcome: "success",
    });
  } catch (error: unknown) {
    maintenanceRunsTotal.inc({
      maintenance_job: kind,
      outcome: "failure",
    });
    throw error;
  }
}

export async function cleanTurboCache(
  fetcher: MaintenanceFetch = fetch,
  cancellationSignal?: AbortSignal,
): Promise<TurboCacheCleanResult> {
  const token = await requiredSecretFile("TURBO_CACHE_TOKEN_FILE");
  const url = new URL(
    Bun.env["TURBO_CACHE_CLEAN_URL"] ?? TURBO_CACHE_CLEAN_URL,
  );
  url.searchParams.set("slug", "monorepo");
  url.searchParams.set("olderThan", "30");

  try {
    const response = await fetcher(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      signal: cancellationSignal ?? Context.current().cancellationSignal,
    });
    if (!response.ok) {
      throw new Error(
        `Turbo cache cleanup failed with HTTP ${String(response.status)}`,
      );
    }
    const result = TurboCacheCleanResponseSchema.parse(
      JSON.parse(await response.text()),
    );
    maintenanceLastSuccessTimestampSeconds.set(
      { maintenance_job: TURBO_CACHE_CLEAN_ACTIVITY },
      Date.now() / 1000,
    );
    maintenanceRunsTotal.inc({
      maintenance_job: TURBO_CACHE_CLEAN_ACTIVITY,
      outcome: "success",
    });
    turboCacheCleanupEntriesTotal.inc({ result: "deleted" }, result.deleted);
    turboCacheCleanupEntriesTotal.inc({ result: "scanned" }, result.scanned);
    log("info", "Turbo cache cleanup completed", result);
    return result;
  } catch (error: unknown) {
    maintenanceRunsTotal.inc({
      maintenance_job: TURBO_CACHE_CLEAN_ACTIVITY,
      outcome: "failure",
    });
    throw error;
  }
}

export type MaintenanceActivities = typeof maintenanceActivities;

export const maintenanceActivities = {
  async runKometa(): Promise<void> {
    await executeMaintenance("kometa");
  },
  async runBunCacheGc(): Promise<void> {
    await executeMaintenance("buildkite-bun-cache-gc");
  },
  async runUvCachePrune(): Promise<void> {
    await executeMaintenance("buildkite-uv-cache-prune");
  },
  async runTrivyDbRefresh(): Promise<void> {
    await executeMaintenance("buildkite-trivy-db-refresh");
  },
  async runTurboCacheClean(): Promise<TurboCacheCleanResult> {
    return cleanTurboCache();
  },
};
