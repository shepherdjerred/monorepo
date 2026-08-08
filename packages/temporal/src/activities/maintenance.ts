import { Context } from "@temporalio/activity";
import {
  maintenanceLastSuccessTimestampSeconds,
  maintenanceRunsTotal,
} from "#observability/metrics.ts";

const KOMETA_CONFIG_PATH = "/etc/kometa/config.yml";
const MAINTENANCE_WORKDIR = "/tmp";
const HEARTBEAT_INTERVAL_MS = 15_000;

export type MaintenanceKind =
  | "kometa"
  | "buildkite-bun-cache-gc"
  | "buildkite-uv-cache-prune"
  | "buildkite-trivy-db-refresh";

export type MaintenanceCommand = {
  kind: MaintenanceKind;
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

function activityHooks(): MaintenanceCommandHooks {
  let context: ReturnType<typeof Context.current> | undefined;
  try {
    context = Context.current();
  } catch {
    context = undefined;
  }

  const hooks: MaintenanceCommandHooks = {
    heartbeat: (payload) => {
      context?.heartbeat(payload);
    },
    onCancellation: () => {
      // The subprocess runner owns cancellation termination.
    },
  };
  if (context !== undefined) {
    hooks.cancellationSignal = context.cancellationSignal;
  }
  return hooks;
}

function commandEnvironment(
  overrides: Record<string, string>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (value !== undefined) {
      environment[key] = value;
    }
  }
  Object.assign(environment, overrides);
  return environment;
}

export function buildMaintenanceCommand(
  kind: MaintenanceKind,
): MaintenanceCommand {
  switch (kind) {
    case "kometa": {
      const plexToken = requiredEnvironment("KOMETA_PLEXTOKEN");
      const tmdbApiKey = requiredEnvironment("KOMETA_TMDBAPIKEY");
      return {
        kind,
        command: ["kometa", "--config", KOMETA_CONFIG_PATH, "--run"],
        cwd: MAINTENANCE_WORKDIR,
        env: commandEnvironment({
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
        env: commandEnvironment({
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
        env: commandEnvironment({ UV_CACHE_DIR: "/buildkite/uv-cache" }),
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
        env: commandEnvironment({}),
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

export const spawnMaintenanceCommand: MaintenanceCommandRunner = async (
  command,
  hooks,
) => {
  const childEnv = command.env;
  const process = Bun.spawn([...command.command], {
    cwd: command.cwd,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const startedAt = Date.now();
  const heartbeatTimer = setInterval(() => {
    hooks.heartbeat({
      kind: command.kind,
      elapsedMs: Date.now() - startedAt,
    });
  }, hooks.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS);
  const abort = (): void => {
    hooks.onCancellation();
    process.kill();
  };
  hooks.cancellationSignal?.addEventListener("abort", abort, { once: true });

  let stderr: string;
  let exitCode: number;
  try {
    [, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
  } finally {
    clearInterval(heartbeatTimer);
    hooks.cancellationSignal?.removeEventListener("abort", abort);
  }

  if (hooks.cancellationSignal?.aborted === true) {
    hooks.cancellationSignal.throwIfAborted();
  }

  if (exitCode !== 0) {
    const detail = redact(stderr.trim(), command.secretValues);
    throw new Error(
      `${command.kind} command exited ${String(exitCode)}${detail === "" ? "" : `: ${detail}`}`,
    );
  }
  return exitCode;
};

export async function executeMaintenance(
  kind: MaintenanceKind,
  runner: MaintenanceCommandRunner = spawnMaintenanceCommand,
): Promise<void> {
  const command = buildMaintenanceCommand(kind);
  try {
    const exitCode = await runner(command, activityHooks());
    if (exitCode !== 0) {
      throw new Error(`${kind} command exited ${String(exitCode)}`);
    }
    maintenanceLastSuccessTimestampSeconds.set(
      { job: kind },
      Date.now() / 1000,
    );
    maintenanceRunsTotal.inc({ job: kind, outcome: "success" });
  } catch (error: unknown) {
    maintenanceRunsTotal.inc({ job: kind, outcome: "failure" });
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
};
